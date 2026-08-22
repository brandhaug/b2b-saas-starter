import { Effect } from 'effect'
import { count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { provisionTestD1, type TestD1 } from './testing.ts'
import { Database, layerFromD1, batch, DbBatchError } from './index.ts'
import {
  apiTokens,
  notifications,
  user,
  workspaceInvitations,
  workspaceMembers,
  workspaces
} from './schema.ts'

// These tests run against a real local D1 (workerd) with all committed
// migrations applied — they validate the schema and D1 semantics the Seed
// layers cannot: migration SQL correctness, column mode round-trips,
// cascade deletes, and batch atomicity.

let test: TestD1
let dbLayer: ReturnType<typeof layerFromD1>

// getPlatformProxy boots a workerd process (~seconds) that the whole suite
// shares and must dispose afterwards. Expressing that as a scoped Layer needs
// `@effect/vitest`'s `it.layer(...)`, which this package does not depend on, so
// vitest's own suite lifecycle owns the process instead.
// oxlint-disable-next-line effect/noTestLifecycleHooks -- owns the workerd process
beforeAll(
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        test = yield* Effect.promise(() => provisionTestD1())
        dbLayer = layerFromD1(test.d1)
      })
    ),
  60_000
)

// oxlint-disable-next-line effect/noTestLifecycleHooks -- disposes the workerd process
afterAll(() => test.dispose())

function run<A, E>(effect: Effect.Effect<A, E, Database>) {
  return Effect.runPromise(Effect.provide(effect, dbLayer))
}

const iso = '2026-07-03T09:00:00.000Z'

// Fixed instants for the plugin-owned timestamp columns. `Clock`/`DateTime`
// buys nothing here: these are fixture literals asserted by value, and the
// contract under test is that the column stores them as epoch integers.
// oxlint-disable-next-line effect/noGlobals -- fixture literal, not runtime time
const createdAtFixture = new Date('2026-08-15T09:00:00.000Z')
// oxlint-disable-next-line effect/noGlobals -- fixture literal, not runtime time
const expiresAtFixture = new Date('2026-08-17T09:00:00.000Z')

describe('migrations', () => {
  it('create every table the schema declares', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          test.d1
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all<{ name: string }>()
        )
        const tables = new Set(rows.results.map((row) => row.name))
        const expected = [
          'user',
          'session',
          'account',
          'verification',
          'workspaces',
          'workspace_members',
          'workspace_invitations',
          'api_tokens',
          'webhook_endpoints',
          'webhook_deliveries',
          'notifications',
          'audit_events'
        ]
        for (const table of expected) {
          expect(tables, `missing table ${table}`).toContain(table)
        }
      })
    ))

  // The organization plugin reads these tables by its own field names. A
  // column the plugin expects but the migration never created is invisible
  // until a plugin endpoint runs, so assert the contract here instead.
  it.each([
    {
      table: 'workspaces',
      columns: [
        'id',
        'name',
        'slug',
        'logo',
        'metadata',
        'planId',
        'createdAt',
        'updatedAt'
      ]
    },
    {
      table: 'workspace_members',
      columns: ['id', 'workspaceId', 'userId', 'role', 'createdAt']
    },
    {
      table: 'workspace_invitations',
      columns: [
        'id',
        'workspaceId',
        'email',
        'role',
        'status',
        'expiresAt',
        'createdAt',
        'inviterId'
      ]
    },
    // The plugin declares this field on `session` unconditionally.
    { table: 'session', columns: ['activeOrganizationId'] }
  ])('give $table the columns the organization plugin expects', ({ table, columns }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          test.d1.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
        )
        const actual = new Set(rows.results.map((row) => row.name))
        for (const column of columns) {
          expect(actual, `${table} is missing ${column}`).toContain(column)
        }
      })
    )
  )
})

describe('column modes over live D1', () => {
  it('round-trips JSON-mode text columns as parsed values', () =>
    run(
      Effect.gen(function* () {
        const database = yield* Database
        yield* database.insert(workspaces).values({
          id: 'wrk_json_check',
          slug: 'json-check',
          name: 'JSON check'
        })
        yield* database.insert(apiTokens).values({
          id: 'tok_json_check',
          workspaceId: 'wrk_json_check',
          name: 'JSON check',
          tokenPrefix: 'bsk_live_json',
          tokenHash: 'hash_json_check',
          scopes: ['read', 'write'],
          createdAt: iso
        })
        const rows = yield* database
          .select()
          .from(apiTokens)
          .where(eq(apiTokens.id, 'tok_json_check'))
        expect(rows[0]?.scopes).toEqual(['read', 'write'])
      })
    ))
})

// Workspace timestamps moved from ISO text to Better Auth's epoch integers.
// The column has to be an integer for the plugin's date handling to work, and
// a `Date` on the way back out for the starter's — assert both halves.
describe('workspace timestamps over live D1', () => {
  it('stores epoch integers and reads them back as Dates', () =>
    run(
      Effect.gen(function* () {
        const database = yield* Database
        const createdAt = createdAtFixture
        yield* database.insert(workspaces).values({
          id: 'wrk_epoch',
          slug: 'epoch-check',
          name: 'Epoch check',
          createdAt,
          updatedAt: createdAt
        })
        const rows = yield* database
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, 'wrk_epoch'))
        expect(rows[0]?.createdAt).toEqual(createdAt)

        // Read around Drizzle to prove the stored value is a number, not text.
        const raw = yield* Effect.promise(() =>
          test.d1
            .prepare(
              'SELECT typeof(createdAt) AS kind, createdAt FROM workspaces WHERE id = ?'
            )
            .bind('wrk_epoch')
            .first<{ kind: string; createdAt: number }>()
        )
        expect(raw?.kind).toBe('integer')
        expect(raw?.createdAt).toBe(Math.floor(createdAt.getTime() / 1000))
      })
    ))

  it('defaults planId and stamps timestamps when the plugin omits them', () =>
    run(
      Effect.gen(function* () {
        const database = yield* Database
        yield* database
          .insert(workspaces)
          .values({ id: 'wrk_default', slug: 'default-check', name: 'Default check' })
        const rows = yield* database
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, 'wrk_default'))
        expect(rows[0]?.planId).toBe('starter')
        expect(rows[0]?.createdAt).toBeInstanceOf(Date)
      })
    ))
})

describe('referential integrity over live D1', () => {
  it('cascade-deletes workspace children when the workspace is removed', () =>
    run(
      Effect.gen(function* () {
        const database = yield* Database
        yield* database.insert(workspaces).values({
          id: 'wrk_cascade',
          slug: 'cascade-check',
          name: 'Cascade check'
        })
        yield* database
          .insert(user)
          .values({ id: 'usr_cascade', email: 'cascade@live.test', name: 'Cascade' })
        // Both tables changed owner in this migration, so their cascade edge is
        // new — assert it alongside the ones that only changed shape.
        yield* database.insert(workspaceMembers).values({
          id: 'mem_cascade',
          workspaceId: 'wrk_cascade',
          userId: 'usr_cascade',
          role: 'owner'
        })
        yield* database.insert(workspaceInvitations).values({
          id: 'inv_cascade',
          workspaceId: 'wrk_cascade',
          email: 'invitee@live.test',
          role: 'member',
          expiresAt: expiresAtFixture,
          inviterId: 'usr_cascade'
        })
        yield* database.insert(apiTokens).values({
          id: 'tok_cascade',
          workspaceId: 'wrk_cascade',
          name: 'Cascade token',
          tokenPrefix: 'bsk_live_casc',
          tokenHash: 'hash_cascade',
          scopes: ['read'],
          createdAt: iso
        })
        yield* database.insert(notifications).values({
          id: 'not_cascade',
          workspaceId: 'wrk_cascade',
          title: 'Cascade notification',
          message: 'gone with the workspace',
          createdAt: iso
        })
        yield* database.delete(workspaces).where(eq(workspaces.id, 'wrk_cascade'))
        const tokens = yield* database
          .select({ value: count() })
          .from(apiTokens)
          .where(eq(apiTokens.workspaceId, 'wrk_cascade'))
        const feed = yield* database
          .select({ value: count() })
          .from(notifications)
          .where(eq(notifications.workspaceId, 'wrk_cascade'))
        const members = yield* database
          .select({ value: count() })
          .from(workspaceMembers)
          .where(eq(workspaceMembers.workspaceId, 'wrk_cascade'))
        const invitations = yield* database
          .select({ value: count() })
          .from(workspaceInvitations)
          .where(eq(workspaceInvitations.workspaceId, 'wrk_cascade'))
        expect({
          tokens: tokens[0]?.value,
          notifications: feed[0]?.value,
          members: members[0]?.value,
          invitations: invitations[0]?.value
        }).toEqual({ tokens: 0, notifications: 0, members: 0, invitations: 0 })
      })
    ))
})

describe('workspace membership over live D1', () => {
  // The plugin addresses members by a surrogate id, so `workspace_members` no
  // longer has a composite primary key. One membership per user per workspace
  // is the invariant that key used to carry, and it must survive the swap.
  it('refuses a second membership row for the same user and workspace', () =>
    run(
      Effect.gen(function* () {
        const database = yield* Database
        yield* database
          .insert(user)
          .values({ id: 'usr_dup', email: 'dup@live.test', name: 'Duplicate' })
        yield* database
          .insert(workspaces)
          .values({ id: 'wrk_dup', slug: 'dup-check', name: 'Duplicate check' })
        yield* database.insert(workspaceMembers).values({
          id: 'mem_dup_first',
          workspaceId: 'wrk_dup',
          userId: 'usr_dup',
          role: 'owner'
        })
        // A different surrogate id, so only the unique index can refuse it.
        const error = yield* Effect.flip(
          database.insert(workspaceMembers).values({
            id: 'mem_dup_second',
            workspaceId: 'wrk_dup',
            userId: 'usr_dup',
            role: 'member'
          })
        )
        const rows = yield* database
          .select({ value: count() })
          .from(workspaceMembers)
          .where(eq(workspaceMembers.workspaceId, 'wrk_dup'))
        expect(error).toBeDefined()
        expect(rows[0]?.value).toBe(1)
      })
    ))
})

describe('workspace invitations over live D1', () => {
  // `workspace_invitations` was a dead table before this migration. It now
  // carries the plugin's state machine, so a row must be storable with the
  // status left to its default — that is how the plugin creates one.
  it('defaults a new invitation to pending', () =>
    run(
      Effect.gen(function* () {
        const database = yield* Database
        yield* database
          .insert(user)
          .values({ id: 'usr_inviter', email: 'inviter@live.test', name: 'Inviter' })
        yield* database
          .insert(workspaces)
          .values({ id: 'wrk_invite', slug: 'invite-check', name: 'Invite check' })
        const expiresAt = expiresAtFixture
        yield* database.insert(workspaceInvitations).values({
          id: 'inv_pending',
          workspaceId: 'wrk_invite',
          email: 'invitee@live.test',
          role: 'member',
          expiresAt,
          inviterId: 'usr_inviter'
        })
        const rows = yield* database
          .select()
          .from(workspaceInvitations)
          .where(eq(workspaceInvitations.id, 'inv_pending'))
        expect(rows[0]?.status).toBe('pending')
        expect(rows[0]?.expiresAt).toEqual(expiresAt)
      })
    ))

  it('cascade-deletes an invitation when its inviter is removed', () =>
    run(
      Effect.gen(function* () {
        const database = yield* Database
        yield* database
          .insert(user)
          .values({ id: 'usr_gone', email: 'gone@live.test', name: 'Gone' })
        yield* database
          .insert(workspaces)
          .values({ id: 'wrk_gone', slug: 'gone-check', name: 'Gone check' })
        yield* database.insert(workspaceInvitations).values({
          id: 'inv_orphan',
          workspaceId: 'wrk_gone',
          email: 'orphan@live.test',
          role: 'member',
          expiresAt: expiresAtFixture,
          inviterId: 'usr_gone'
        })
        yield* database.delete(user).where(eq(user.id, 'usr_gone'))
        const rows = yield* database
          .select({ value: count() })
          .from(workspaceInvitations)
          .where(eq(workspaceInvitations.id, 'inv_orphan'))
        expect(rows[0]?.value).toBe(0)
      })
    ))
})

describe('batch atomicity over live D1', () => {
  it('rolls back every statement when one fails', () =>
    run(
      Effect.gen(function* () {
        const database = yield* Database
        yield* database.insert(workspaces).values({
          id: 'wrk_batch_existing',
          slug: 'batch-existing',
          name: 'Batch existing'
        })
        // Second statement violates the primary key, so the whole batch —
        // including the valid first insert — must roll back.
        const error = yield* Effect.flip(
          batch(database, [
            database.insert(workspaces).values({
              id: 'wrk_batch_new',
              slug: 'batch-new',
              name: 'Batch new'
            }),
            database.insert(workspaces).values({
              id: 'wrk_batch_existing',
              slug: 'batch-duplicate',
              name: 'Batch duplicate'
            })
          ])
        )
        const rows = yield* database
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, 'wrk_batch_new'))
        expect(error).toBeInstanceOf(DbBatchError)
        expect(rows).toHaveLength(0)
      })
    ))
})
