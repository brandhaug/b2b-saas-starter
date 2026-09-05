import { describe, expect, it } from 'vite-plus/test'

import { MembershipRefusedError, UserAdminRefusedError } from './capability-error'

/**
 * The refusal-copy half of the capability boundary: each machine reason the
 * membership and user-admin capabilities refuse with maps to one sentence,
 * and anything else falls back to a sentence that is true for every plugin
 * refusal rather than one sniffed out of its message text.
 */
describe('MembershipRefusedError', () => {
  it('words the machine refusal reasons', () => {
    expect(new MembershipRefusedError('not_a_member').message).toBe(
      'That person is not a member of this workspace.'
    )
    expect(new MembershipRefusedError('sole_owner').message).toBe(
      'The workspace must keep an owner: transfer ownership to another member first.'
    )
    expect(new MembershipRefusedError('owner_requires_owner').message).toBe(
      "Only a workspace owner can grant or change an owner's role."
    )
  })

  it('falls back to the honest no for an unclassified plugin refusal', () => {
    // A plugin refusal the boundary cannot classify — its reason is message
    // text, and matching on that is the sniffing the boundary exists to
    // avoid. The fallback must not pretend to understand it.
    expect(new MembershipRefusedError('Role not found').message).toBe(
      'The workspace refused this membership change.'
    )
    expect(new MembershipRefusedError('Role not found').name).toBe(
      'MembershipRefusedError'
    )
  })
})

describe('UserAdminRefusedError', () => {
  it('words the machine refusal reasons', () => {
    expect(new UserAdminRefusedError('unknown_user').message).toBe(
      'That account does not exist.'
    )
    expect(new UserAdminRefusedError('not_a_member').message).toBe(
      'That person is not a member of the named workspace.'
    )
  })

  it('explains the system-axis constraint for an unclassified plugin refusal', () => {
    // The realistic unclassified refusal on `/admin`'s role editor: the
    // plugin refusing because the System Admin holds no standing in the
    // target workspace. The sentence states the constraint the surface's
    // docs state, not a guess at the plugin's message.
    expect(
      new UserAdminRefusedError('You are not allowed to update this member').message
    ).toBe(
      'The workspace refused this change: a System Admin can only change a membership in a workspace where they are also an admin or owner — the system role confers nothing inside a workspace.'
    )
    expect(
      new UserAdminRefusedError('You are not allowed to update this member').name
    ).toBe('UserAdminRefusedError')
  })
})
