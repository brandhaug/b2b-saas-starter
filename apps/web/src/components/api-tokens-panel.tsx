import { type ApiToken } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { ApiTokenForm, type CreateApiToken } from '@/components/api-token-form'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle
} from '@/components/ui/item'
import { ConfirmButton } from '@/components/confirm-button'
import { viewerCan, type Viewer } from '@/lib/permissions'
import { revokeApiTokenServerFn } from '@/lib/server/api-tokens'
import { callServerFn } from '@/lib/server-call'

const REVOKE_FAILED = 'Failed to revoke token'

/**
 * Revoking a token, as a port. Injected rather than imported at the call site
 * so a test drives the panel with a real function of this shape instead of
 * replacing the module it lives in. The default is the production server
 * function, so every caller but a test passes nothing.
 */
export type RevokeApiToken = (input: {
  readonly data: {
    readonly workspaceSlug: string
    readonly tokenId: string
  }
}) => Promise<boolean>

// An explicit locale and timezone keeps SSR and the browser in agreement.
function formatDate(iso: string | null): string {
  if (iso === null) return 'never'
  return new Date(iso).toLocaleString('en-US', { timeZone: 'UTC' })
}

/**
 * The workspace's API tokens: create (secret shown once), list, revoke.
 * Presentation only — the controls render when the role authorizes them, and
 * every mutation is re-checked server-side by `requireWorkspacePermission` in
 * its server fn.
 */
export function ApiTokensPanel({
  workspaceSlug,
  tokens,
  viewer,
  revokeToken = revokeApiTokenServerFn,
  createToken
}: {
  readonly workspaceSlug: string
  readonly tokens: readonly ApiToken[]
  readonly viewer: Viewer
  readonly revokeToken?: RevokeApiToken
  readonly createToken?: CreateApiToken
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  // Revocation is irreversible, so it takes a click to arm and a second to
  // commit — the same two-step pattern the settings page's delete uses.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const canCreate = viewerCan(viewer, { apiToken: ['create'] })
  const canRevoke = viewerCan(viewer, { apiToken: ['revoke'] })

  async function revoke(tokenId: string) {
    setError(null)
    setRevoking(tokenId)
    const outcome = await callServerFn(
      () => revokeToken({ data: { workspaceSlug, tokenId } }),
      REVOKE_FAILED
    )
    setRevoking(null)
    if (!outcome.ok) {
      setError(outcome.message)
      return
    }
    // The loader owns the list, so re-run it rather than mirroring the
    // revoked row into local state.
    await router.invalidate()
  }

  return (
    <div className="grid gap-6">
      {canCreate ? (
        <div className="grid gap-2">
          <h2 className="text-sm font-medium">Create a token</h2>
          <ApiTokenForm
            workspaceSlug={workspaceSlug}
            onCreated={() => void router.invalidate()}
            {...(createToken === undefined ? {} : { createToken })}
          />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Your role cannot mint tokens.</p>
      )}

      <div className="grid gap-2">
        <h2 className="text-sm font-medium">Active tokens</h2>
        {tokens.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No active tokens</EmptyTitle>
              <EmptyDescription>Create one above to get started.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup>
            {tokens.map((token) => (
              <Item key={token.id} variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>
                    {token.name}
                    <code className="rounded-sm bg-muted px-1.5 py-0.5 text-xs">
                      {token.prefix}…
                    </code>
                  </ItemTitle>
                  <ItemDescription>
                    Created {formatDate(token.createdAt)} · Last used{' '}
                    {formatDate(token.lastUsedAt)}
                  </ItemDescription>
                  <div className="flex flex-wrap gap-1">
                    {token.scopes.map((scope) => (
                      <Badge key={scope} variant="outline">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                </ItemContent>
                {canRevoke ? (
                  <ItemActions>
                    <ConfirmButton
                      label="Revoke"
                      confirmLabel="Confirm revoke"
                      armed={confirmingId === token.id}
                      busy={revoking === token.id}
                      onArm={() => setConfirmingId(token.id)}
                      onCancel={() => setConfirmingId(null)}
                      onConfirm={() => void revoke(token.id)}
                    />
                  </ItemActions>
                ) : null}
              </Item>
            ))}
          </ItemGroup>
        )}
        {canRevoke ? null : (
          <p className="text-xs text-muted-foreground">
            Your role cannot revoke tokens.
          </p>
        )}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
