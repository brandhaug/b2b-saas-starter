import { UserId, WorkspaceId } from '@b2b-saas-starter/db/ids'
import { describe, expect, layer } from '@effect/vitest'
import { Clock, DateTime, Effect, Schema } from 'effect'
import { Database } from '@b2b-saas-starter/db/service'
import { session } from '@b2b-saas-starter/db/schema/auth'
import { workspaceMembers } from '@b2b-saas-starter/db/schema/workspaces'
import { eq } from 'drizzle-orm'
import {
  TestDatabase,
  inWorkspace,
  LIVE_SUITE_TIMEOUT
} from '../testing/live-harness.ts'
import { PersonalDataExports } from '../governance/personal-data-export.ts'
import { PersonalDataExport } from '../governance/personal-data-export-archive.ts'
import { AssistantDirectory } from './directory.ts'
import { type AssistantLifecycleBinding } from './lifecycle.ts'

const decodeArchive = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PersonalDataExport)
)
const host: AssistantLifecycleBinding = {
  exportConversation: () =>
    Effect.succeed({ json: '{"savedAnswer":"private answer"}' }),
  revalidateConversation: () => Effect.succeed(true),
  destroyConversation: () => Effect.void
}

describe('personal conversation archive invalidation', () => {
  layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
    'D1 artifact lifecycle',
    (it) => {
      it.effect(
        'denies a previously generated archive after role loss and restoration',
        () =>
          inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const db = yield* Database
              const directory = yield* AssistantDirectory
              const exports = yield* PersonalDataExports
              const now = yield* Clock.currentTimeMillis
              // The subject can lose and regain its role while another owner
              // keeps the workspace owned throughout the invalidation test.
              yield* db.insert(workspaceMembers).values({
                id: 'mem_export_stable_owner',
                workspaceId: WorkspaceId.make('wrk_live'),
                userId: UserId.make('usr_sysadmin'),
                role: 'owner'
              })
              yield* db.insert(session).values({
                id: 'conversation-export-session',
                userId: UserId.make('usr_owner'),
                token: 'synthetic-export-token',
                expiresAt: DateTime.toDate(DateTime.makeUnsafe(now + 86_400_000))
              })
              yield* directory.create({
                id: 'personal-conversation',
                workspaceId: WorkspaceId.make('wrk_live'),
                creatorUserId: UserId.make('usr_owner')
              })
              const receipt = yield* exports.request(
                UserId.make('usr_owner'),
                'conversation-export-session'
              )
              const archive = yield* decodeArchive(
                (yield* exports.download(
                  UserId.make('usr_owner'),
                  'conversation-export-session',
                  receipt.id
                )).json
              )
              expect(archive.conversations[0]?.history).toEqual({
                savedAnswer: 'private answer'
              })
              yield* db
                .update(workspaceMembers)
                .set({ role: 'member' })
                .where(eq(workspaceMembers.id, 'mem_live_owner'))
              yield* db
                .update(workspaceMembers)
                .set({ role: 'owner' })
                .where(eq(workspaceMembers.id, 'mem_live_owner'))
              const stale = yield* exports
                .download(
                  UserId.make('usr_owner'),
                  'conversation-export-session',
                  receipt.id
                )
                .pipe(Effect.result)
              expect(stale._tag).toBe('Failure')
            }),
            { userId: UserId.make('usr_owner') },
            { assistantLifecycle: host }
          )
      )
    }
  )
})
