import { type ApiToken } from '@b2b-saas-starter/capabilities/src/developer-platform/api-token-registry.ts'
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Cause, Effect, Exit, Option } from 'effect'

import { ApiTokenForm, type CreateApiToken } from '@/components/api-token-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { causeMessage } from '@/lib/cause-message'
import { viewerCan, type Viewer } from '@/lib/permissions'
import { revokeApiTokenServerFn } from '@/lib/server/api-tokens'

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

  const canCreate = viewerCan(viewer, { apiToken: ['create'] })
  const canRevoke = viewerCan(viewer, { apiToken: ['revoke'] })

  async function revoke(tokenId: string) {
    setError(null)
    setRevoking(tokenId)
    const exit = await Effect.runPromiseExit(
      Effect.tryPromise({
        try: () => revokeToken({ data: { workspaceSlug, tokenId } }),
        catch: (cause) => causeMessage(cause, REVOKE_FAILED)
      })
    )
    setRevoking(null)
    if (Exit.isFailure(exit)) {
      setError(Option.getOrElse(Cause.findErrorOption(exit.cause), () => REVOKE_FAILED))
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
          <p className="text-xs text-muted-foreground">No active tokens.</p>
        ) : (
          <ul className="grid gap-2">
            {tokens.map((token) => (
              <li
                key={token.id}
                className="flex items-center justify-between gap-4 rounded-md border border-border p-3"
              >
                <div className="grid gap-0.5">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {token.name}
                    <code className="rounded-sm bg-muted px-1.5 py-0.5 text-xs">
                      {token.prefix}…
                    </code>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Created {formatDate(token.createdAt)} · Last used{' '}
                    {formatDate(token.lastUsedAt)}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {token.scopes.map((scope) => (
                      <Badge key={scope} variant="outline">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                </div>
                {canRevoke ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revoking === token.id}
                    onClick={() => void revoke(token.id)}
                  >
                    Revoke
                    {revoking === token.id ? '…' : ''}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canRevoke ? null : (
          <p className="text-xs text-muted-foreground">
            Your role cannot revoke tokens.
          </p>
        )}
      </div>

      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
