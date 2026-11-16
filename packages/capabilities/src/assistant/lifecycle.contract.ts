import { UserId, WorkspaceId } from '@b2b-saas-starter/db/ids'
import { ConversationUnavailable } from '../developer-platform/assistant-conversation.ts'
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
          workspaceId: WorkspaceId.make('concurrent'),
          creatorUserId: UserId.make('other')
        })
        yield* Effect.gen(function* () {
          const lifecycle = yield* AssistantConversationLifecycle
          expect(
            yield* lifecycle
              .collectForExport(UserId.make('other'), 'session')
              .pipe(Effect.result)
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
          workspaceId: WorkspaceId.make('workspace'),
          creatorUserId: UserId.make('export-owner')
        })
        yield* directory.create({
          id: 'export-other',
          workspaceId: WorkspaceId.make('workspace'),
          creatorUserId: UserId.make('other')
        })
        const host: AssistantLifecycleBinding = {
          exportConversation: () =>
            Effect.succeed({
              json: '{"questions":[{"id":"question","attempts":[{"id":"interrupted","status":"Interrupted","text":"partial"},{"id":"completed","status":"Completed","text":"answer"}],"taskId":"task-reference"}]}'
            }),
          revalidateConversation: () => Effect.succeed(true),
          destroyConversation: () => Effect.void
        }
        yield* Effect.gen(function* () {
          const lifecycle = yield* AssistantConversationLifecycle
          const result = yield* lifecycle.collectForExport(
            UserId.make('export-owner'),
            'session'
          )
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
              .validateExport(UserId.make('export-owner'), 'session', result.manifest)
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
          workspaceId: WorkspaceId.make('workspace'),
          creatorUserId: UserId.make('restore-owner')
        })
        let authorized = true
        const host: AssistantLifecycleBinding = {
          exportConversation: () => Effect.succeed({ json: '[]' }),
          revalidateConversation: () => Effect.sync(() => authorized),
          destroyConversation: () => Effect.void
        }
        yield* Effect.gen(function* () {
          const lifecycle = yield* AssistantConversationLifecycle
          const result = yield* lifecycle.collectForExport(
            UserId.make('restore-owner'),
            'session'
          )
          authorized = false
          expect(
            (yield* lifecycle
              .validateExport(UserId.make('restore-owner'), 'session', result.manifest)
              .pipe(Effect.result))._tag
          ).toBe('Failure')
          yield* directory.invalidateAccess({
            creatorUserId: UserId.make('restore-owner')
          })
          authorized = true
          expect(
            (yield* lifecycle
              .validateExport(UserId.make('restore-owner'), 'session', result.manifest)
              .pipe(Effect.result))._tag
          ).toBe('Failure')
          const fresh = yield* lifecycle.collectForExport(
            UserId.make('restore-owner'),
            'session'
          )
          yield* lifecycle.validateExport(
            UserId.make('restore-owner'),
            'session',
            fresh.manifest
          )
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
          workspaceId: WorkspaceId.make('workspace'),
          creatorUserId: UserId.make('cleanup-owner')
        })
        let shouldFail = true
        const deleted: Array<string> = []
        const host: AssistantLifecycleBinding = {
          exportConversation: () => Effect.succeed({ json: '[]' }),
          revalidateConversation: () => Effect.succeed(false),
          destroyConversation: ({ conversationId }) => {
            if (shouldFail) {
              return Effect.fail(new ConversationUnavailable({ reason: 'storage' }))
            }
            return Effect.sync(() => {
              deleted.push(conversationId)
            })
          }
        }
        yield* Effect.gen(function* () {
          const lifecycle = yield* AssistantConversationLifecycle
          yield* lifecycle.deleteOwned(UserId.make('other'), 'cleanup')
          expect((yield* directory.get('cleanup'))?.deletedAt).toBe(null)
          yield* lifecycle.deleteOwned(UserId.make('cleanup-owner'), 'cleanup')
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
