// oxlint-disable effect/noNewPromise -- The host port returns promises; these deterministic fixtures exercise its rejection and lifecycle contract.
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { Effect } from 'effect'
import { type ContractExpect } from '../governance/contract-expect.ts'
import { AssistantDirectory } from './directory.ts'
import {
  AssistantConversationLifecycle,
  AssistantConversationLifecycleLayer,
  type AssistantLifecycleBinding
} from './lifecycle.ts'

export function assistantLifecycleContractCases(expect: ContractExpect) {
  return [
    {
      name: 'refuses private export when conversation storage is unconfigured',
      assert: Effect.gen(function* () {
        const directory = yield* AssistantDirectory
        yield* directory.create({
          id: 'unconfigured-export',
          workspaceId: 'concurrent',
          creatorUserId: 'other'
        })
        yield* Effect.gen(function* () {
          const lifecycle = yield* AssistantConversationLifecycle
          expect(
            yield* lifecycle.collectForExport('other', 'session').pipe(Effect.result)
          ).toMatchObject({
            _tag: 'Failure',
            failure: {
              _tag: 'CapabilityUnavailable',
              reason: 'conversation_host_unconfigured'
            }
          })
        }).pipe(Effect.provide(AssistantConversationLifecycleLayer()))
      })
    },
    {
      name: 'exports saved attempts only for the creator and refuses cached history after a policy change',
      assert: Effect.gen(function* () {
        const directory = yield* AssistantDirectory
        yield* directory.create({
          id: 'export-visible',
          workspaceId: 'workspace',
          creatorUserId: 'export-owner'
        })
        yield* directory.create({
          id: 'export-other',
          workspaceId: 'workspace',
          creatorUserId: 'other'
        })
        const host: AssistantLifecycleBinding = {
          exportConversation: () =>
            Promise.resolve({
              json: '{"questions":[{"id":"question","attempts":[{"id":"interrupted","status":"Interrupted","text":"partial"},{"id":"completed","status":"Completed","text":"answer"}],"taskId":"task-reference"}]}'
            }),
          revalidateConversation: () => Promise.resolve(true),
          destroyConversation: () => Promise.resolve()
        }
        yield* Effect.gen(function* () {
          const lifecycle = yield* AssistantConversationLifecycle
          const result = yield* lifecycle.collectForExport('export-owner', 'session')
          expect(result.conversations).toHaveLength(1)
          expect(result.conversations[0]?.history).toEqual({
            questions: [
              {
                id: 'question',
                attempts: [
                  { id: 'interrupted', status: 'Interrupted', text: 'partial' },
                  { id: 'completed', status: 'Completed', text: 'answer' }
                ],
                taskId: 'task-reference'
              }
            ]
          })
          yield* directory.raisePolicy('export-visible', ['webhook:list'])
          expect(
            (yield* lifecycle
              .validateExport('export-owner', 'session', result.manifest)
              .pipe(Effect.result))._tag
          ).toBe('Failure')
        }).pipe(
          Effect.provide(AssistantConversationLifecycleLayer(host)),
          Effect.provideService(AssistantDirectory, directory)
        )
      })
    },
    {
      name: 'revalidates every cached archive and keeps it stale after access restoration',
      assert: Effect.gen(function* () {
        const directory = yield* AssistantDirectory
        yield* directory.create({
          id: 'export-restoration',
          workspaceId: 'workspace',
          creatorUserId: 'restore-owner'
        })
        let authorized = true
        const host: AssistantLifecycleBinding = {
          exportConversation: () => Promise.resolve({ json: '[]' }),
          revalidateConversation: () => Promise.resolve(authorized),
          destroyConversation: () => Promise.resolve()
        }
        yield* Effect.gen(function* () {
          const lifecycle = yield* AssistantConversationLifecycle
          const result = yield* lifecycle.collectForExport('restore-owner', 'session')
          authorized = false
          expect(
            (yield* lifecycle
              .validateExport('restore-owner', 'session', result.manifest)
              .pipe(Effect.result))._tag
          ).toBe('Failure')
          yield* directory.invalidateAccess({ creatorUserId: 'restore-owner' })
          authorized = true
          expect(
            (yield* lifecycle
              .validateExport('restore-owner', 'session', result.manifest)
              .pipe(Effect.result))._tag
          ).toBe('Failure')
          const fresh = yield* lifecycle.collectForExport('restore-owner', 'session')
          yield* lifecycle.validateExport('restore-owner', 'session', fresh.manifest)
        }).pipe(
          Effect.provide(AssistantConversationLifecycleLayer(host)),
          Effect.provideService(AssistantDirectory, directory)
        )
      })
    },
    {
      name: 'fences identity-owned deletion after membership loss and retries failed object cleanup',
      assert: Effect.gen(function* () {
        const directory = yield* AssistantDirectory
        yield* directory.create({
          id: 'cleanup',
          workspaceId: 'workspace',
          creatorUserId: 'cleanup-owner'
        })
        let shouldFail = true
        const deleted: Array<string> = []
        const host: AssistantLifecycleBinding = {
          exportConversation: () => Promise.resolve({ json: '[]' }),
          revalidateConversation: () => Promise.resolve(false),
          destroyConversation: ({ conversationId }) => {
            if (shouldFail) {
              return Promise.reject(
                new CapabilityUnavailable({
                  capability: 'assistant-host-fixture',
                  reason: 'injected_failure'
                })
              )
            }
            deleted.push(conversationId)
            return Promise.resolve()
          }
        }
        yield* Effect.gen(function* () {
          const lifecycle = yield* AssistantConversationLifecycle
          yield* lifecycle.deleteOwned('other', 'cleanup')
          expect((yield* directory.get('cleanup'))?.deletedAt).toBe(null)
          yield* lifecycle.deleteOwned('cleanup-owner', 'cleanup')
          expect((yield* directory.get('cleanup'))?.deletedAt === null).toBe(false)
          expect((yield* lifecycle.cleanup().pipe(Effect.result))._tag).toBe('Failure')
          expect((yield* directory.get('cleanup'))?.cleanedAt).toBe(null)
          shouldFail = false
          yield* lifecycle.cleanup()
          yield* lifecycle.cleanup()
          expect(deleted.filter((id) => id === 'cleanup')).toHaveLength(1)
          expect((yield* directory.get('cleanup'))?.cleanedAt === null).toBe(false)
        }).pipe(
          Effect.provide(AssistantConversationLifecycleLayer(host)),
          Effect.provideService(AssistantDirectory, directory)
        )
      })
    }
  ]
}
