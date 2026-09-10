import { type Member, type Workspace } from './workspace-identity.ts'

/**
 * The Seed Workspace's identity and roster, kept in a data-only leaf so
 * browser code (the public showcase and the /demo preview) can render the
 * same workspace the app seeds without pulling the fixture's Effect Schema
 * graph into the client bundle. `seed-fixture.ts` re-exports these.
 */
export const seedWorkspaceRecord: Workspace = {
  id: 'wrk_starter',
  slug: 'starter-lab',
  name: 'Starter Lab',
  planId: 'team'
}

/**
 * The demo credential account's identity, shared with the D1 seed
 * (scripts/seed.ts, which adds only the password locally). One constant
 * preserves Seed/Live equivalence: client-side navigations resolve
 * membership against the fixture members, so the demo user must be a member
 * in BOTH layers or SPA navigation 404s while full-page loads succeed.
 */
export const demoUserIdentity: Member = {
  id: 'usr_demo',
  name: 'Demo Admin',
  email: 'demo@starter.local',
  role: 'owner',
  systemRole: 'admin'
}

/**
 * The plain `member` of the seed workspace, named because the seed script gives
 * it a credential account too: signing in as it is how the role-gated UI (the
 * hidden API-token and webhook sections) is visible in local dev and e2e. The
 * demo user is an owner and therefore shows none of it.
 */
export const demoMemberIdentity: Member = {
  id: 'usr_dev',
  name: 'Product Engineer',
  email: 'engineer@example.com',
  role: 'member',
  systemRole: 'user'
}

export const seedMembers: ReadonlyArray<Member> = [
  demoUserIdentity,
  {
    id: 'usr_martin',
    name: 'Martin Brandhaug',
    email: 'martin@example.com',
    role: 'owner',
    systemRole: 'admin'
  },
  {
    id: 'usr_ops',
    name: 'Ops Lead',
    email: 'ops@example.com',
    role: 'admin',
    systemRole: 'user'
  },
  demoMemberIdentity
]
