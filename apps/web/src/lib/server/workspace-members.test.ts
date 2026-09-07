import { describe, expect, it, vi, beforeEach } from 'vite-plus/test'

import { fixtureSession } from '@/test/fixture-session'
import {
  changeMemberRoleHandler,
  leaveWorkspaceHandler,
  loadWorkspaceMembersHandler,
  removeMemberHandler
} from './workspace-members.effects'
import type * as AuthModule from './auth'

/**
 * The member-management surface, driven through its handlers. The session
 * gate is the one thing a request would add, so the mock answers
 * `requireRequestSession` with the fixture identity under test and
 * everything else is the real path: `runWorkspaceCapabilities` resolves the
 * inert `cloudflare:workers` shim under Vitest (vite.config.ts), so `DB` is
 * undefined and the in-memory Seed roster answers. The seed workspace
 * `starter-lab` has two owners (`usr_demo`, `usr_martin`), an admin
 * (`usr_ops`), and a plain member (`usr_dev`) — the matrix's member verbs
 * read exactly off those roles.
 *
 * Each call builds its own Seed layer, so a mutation asserts its own call's
 * outcome (the returned member, the resolved void) rather than a follow-up
 * read. The ownership refusals (sole owner) stay where the roster shape can
 * be staged for them: the membership capability's contract tests.
 *
 * Real clock on purpose: plain `it`, not `it.effect`.
 */
const actor = vi.hoisted(() => ({ userId: 'usr_demo' }))

vi.mock('./auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireRequestSession: async () => fixtureSession(actor)
}))

function actingAs(userId: string): void {
  actor.userId = userId
}

describe('loadWorkspaceMembersHandler', () => {
  it('lists the roster plus the invitation segment for an owner', async () => {
    const payload = await loadWorkspaceMembersHandler({ workspaceSlug: 'starter-lab' })
    expect(payload.viewer).toEqual({ role: 'owner' })
    expect(payload.unreadCount).toBeTypeOf('number')
    expect(payload.members.length).toBeGreaterThan(0)
    expect(payload.members.map((member) => member.id)).toContain('usr_dev')
    // An owner holds `invitation:create`, so the invitation list is real data.
    expect(payload.invitations).toBeInstanceOf(Array)
    expect(payload.emailDeliveries).toBeInstanceOf(Array)
  })

  it('shows a plain member the roster but withholds the invitations', async () => {
    actingAs('usr_dev')
    const payload = await loadWorkspaceMembersHandler({ workspaceSlug: 'starter-lab' })
    expect(payload.viewer).toEqual({ role: 'member' })
    expect(payload.members.length).toBeGreaterThan(0)
    // Denied by the matrix — and denied server-side, so the invitation list
    // never reaches the serialized loader payload at all.
    expect(payload.invitations).toBeNull()
    expect(payload.emailDeliveries).toBeNull()
  })
})

describe('changeMemberRoleHandler', () => {
  beforeEach(() => actingAs('usr_demo'))

  it('denies a member the change', async () => {
    actingAs('usr_dev')
    await expect(
      changeMemberRoleHandler({
        workspaceSlug: 'starter-lab',
        userId: 'usr_martin',
        role: 'member'
      })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })

  it('lets an admin re-role too — the matrix grants admin member:update', async () => {
    actingAs('usr_ops')
    const member = await changeMemberRoleHandler({
      workspaceSlug: 'starter-lab',
      userId: 'usr_dev',
      role: 'member'
    })
    expect(member).toMatchObject({ id: 'usr_dev', role: 'member' })
  })

  it('lets an owner re-role, and answers with the changed member', async () => {
    const member = await changeMemberRoleHandler({
      workspaceSlug: 'starter-lab',
      userId: 'usr_ops',
      role: 'member'
    })
    expect(member).toMatchObject({ id: 'usr_ops', role: 'member' })
  })
})

describe('removeMemberHandler', () => {
  beforeEach(() => actingAs('usr_demo'))

  it('denies a member the removal', async () => {
    actingAs('usr_dev')
    await expect(
      removeMemberHandler({ workspaceSlug: 'starter-lab', userId: 'usr_martin' })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })

  it('lets an owner off-board a member', async () => {
    await expect(
      removeMemberHandler({ workspaceSlug: 'starter-lab', userId: 'usr_ops' })
    ).resolves.toBeUndefined()
  })
})

describe('leaveWorkspaceHandler', () => {
  it('is any member’s own verb — no permission gate refuses a plain member', async () => {
    actingAs('usr_dev')
    await expect(
      leaveWorkspaceHandler({ workspaceSlug: 'starter-lab' })
    ).resolves.toBeUndefined()
  })
})
