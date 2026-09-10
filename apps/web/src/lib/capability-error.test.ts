import { describe, expect, it } from 'vite-plus/test'

import { MembershipRefusedError, UserAdminRefusedError } from './capability-error'

/**
 * The refusal half of the capability boundary: each machine reason the
 * membership and user-admin capabilities refuse with crosses to the browser
 * as itself, and anything else collapses to `refused` rather than leaking a
 * plugin's message text as a pseudo-reason.
 */
describe('MembershipRefusedError', () => {
  it('carries the machine refusal reasons', () => {
    expect(new MembershipRefusedError('not_a_member').details).toEqual({
      reason: 'not_a_member'
    })
    expect(new MembershipRefusedError('sole_owner').details).toEqual({
      reason: 'sole_owner'
    })
    expect(new MembershipRefusedError('owner_requires_owner').details).toEqual({
      reason: 'owner_requires_owner'
    })
  })

  it('collapses an unclassified plugin refusal', () => {
    // A plugin refusal the boundary cannot classify — its reason is message
    // text, and matching on that is the sniffing the boundary exists to
    // avoid.
    const error = new MembershipRefusedError('Role not found')
    expect(error.details).toEqual({ reason: 'refused' })
    expect(error.name).toBe('MembershipRefusedError')
  })
})

describe('UserAdminRefusedError', () => {
  it('carries the machine refusal reasons', () => {
    expect(new UserAdminRefusedError('unknown_user').details).toEqual({
      reason: 'unknown_user'
    })
    expect(new UserAdminRefusedError('not_a_member').details).toEqual({
      reason: 'not_a_member'
    })
  })

  it('collapses an unclassified plugin refusal', () => {
    // The realistic unclassified refusal on `/admin`'s role editor: the
    // plugin refusing because the System Admin holds no standing in the
    // target workspace.
    const error = new UserAdminRefusedError('You are not allowed to update this member')
    expect(error.details).toEqual({ reason: 'refused' })
    expect(error.name).toBe('UserAdminRefusedError')
  })
})
