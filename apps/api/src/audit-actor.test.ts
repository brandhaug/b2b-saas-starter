import {
  AuditEventLog,
  recordInWorkspace,
  SeedAuditEventLog
} from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { seedWorkspaceRecord } from '@b2b-saas-starter/capabilities/seed-fixture'
import { Effect } from 'effect'
import { describe, expect, test } from 'vite-plus/test'
import {
  mcpCallerActor,
  mcpCallerActorType,
  provideWorkspace,
  type McpCaller
} from './request-guards.ts'

const workspace = {
  workspaceId: seedWorkspaceRecord.id,
  workspaceSlug: seedWorkspaceRecord.slug
}

describe('MCP audit provenance', () => {
  const cases: ReadonlyArray<{ caller: McpCaller; actorType: string }> = [
    {
      caller: {
        kind: 'token',
        token: { ...workspace, id: 'tok_ci', scopes: ['read'] }
      },
      actorType: 'api_token'
    },
    {
      caller: {
        kind: 'oauth',
        token: {
          ...workspace,
          userId: 'usr_demo',
          workspaceRole: 'owner',
          scopes: ['mcp:read']
        }
      },
      actorType: 'user'
    }
  ]

  test.each(cases)(
    '$caller.kind retains provenance through workspace resolution and recording',
    ({ caller, actorType }) =>
      Effect.runPromise(
        provideWorkspace(
          {},
          workspace.workspaceSlug,
          Effect.gen(function* () {
            const audit = yield* AuditEventLog
            yield* recordInWorkspace(audit, {
              eventType: 'api_token.created',
              targetType: 'api_token',
              targetId: 'tok_created'
            })
            const page = yield* audit.list()
            expect(page.items).toHaveLength(1)
            expect(page.items[0]?.actorType).toBe(actorType)
          }),
          mcpCallerActor(caller),
          mcpCallerActorType(caller)
        ).pipe(Effect.provide(SeedAuditEventLog([])))
      )
  )
})
