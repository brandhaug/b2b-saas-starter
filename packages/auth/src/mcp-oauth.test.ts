import { describe, expect, it } from 'vite-plus/test'
import { APIError } from 'better-auth/api'
import {
  MCP_WORKSPACE_SELECTED_HEADER,
  mcpWorkspaceNeedsSelection,
  mcpWorkspaceReferenceId
} from './mcp-oauth.ts'

// The two pure halves of the workspace pick: whether the plugin's post-login
// hop must run again, and what the consent's reference id is once it has.

describe('mcpWorkspaceNeedsSelection', () => {
  const session = { id: 'ses_1', activeOrganizationId: 'wrk_a' }

  it('redirects every request that does not vouch for the workspace on the session', () => {
    expect(mcpWorkspaceNeedsSelection(new Headers(), session)).toBe(true)
    // A stale pick from an earlier flow is exactly what the header exists to
    // distrust: the value has to match the session's current workspace.
    expect(
      mcpWorkspaceNeedsSelection(
        new Headers({ [MCP_WORKSPACE_SELECTED_HEADER]: 'wrk_b' }),
        session
      )
    ).toBe(true)
    expect(
      mcpWorkspaceNeedsSelection(
        new Headers({ [MCP_WORKSPACE_SELECTED_HEADER]: 'wrk_a' }),
        { id: 'ses_1', activeOrganizationId: null }
      )
    ).toBe(true)
  })

  it('lets the request through once the header names the picked workspace', () => {
    expect(
      mcpWorkspaceNeedsSelection(
        new Headers({ [MCP_WORKSPACE_SELECTED_HEADER]: 'wrk_a' }),
        session
      )
    ).toBe(false)
  })
})

describe('mcpWorkspaceReferenceId', () => {
  it('is the picked workspace', () => {
    expect(
      mcpWorkspaceReferenceId({ id: 'ses_1', activeOrganizationId: 'wrk_a' })
    ).toBe('wrk_a')
  })

  it('refuses to consent without a pick', () => {
    // Better Auth's APIError carries the code in its body, not `message`, so
    // the type is the assertion.
    expect(() => mcpWorkspaceReferenceId({ id: 'ses_1' })).toThrow(APIError)
    expect(() => mcpWorkspaceReferenceId(undefined)).toThrow(APIError)
  })
})
