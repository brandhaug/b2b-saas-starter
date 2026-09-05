import { type ApiToken } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { ApiTokenForm, type CreateApiToken } from '@/components/api-token-form'
import { Badge } from '@/components/ui/badge'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle
} from '@/components/ui/item'
import { ConfirmButton } from '@/components/confirm-button'
import { ActionFeedback } from '@/components/page/action-feedback'
import { CreateSection, ListSection, Panel } from '@/components/page/panel'
import { Identifier } from '@/components/page/identifier'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { formatUtcOr } from '@/lib/format-date'
import { viewerCan, type Viewer } from '@/lib/permissions'
import { revokeApiTokenServerFn } from '@/lib/server/api-tokens'
import { useKeyedFailure } from '@/hooks/use-keyed-failure'
import { useServerAction } from '@/hooks/use-server-action'

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
  readonly tokens: ReadonlyArray<ApiToken>
  readonly viewer: Viewer
  readonly revokeToken?: RevokeApiToken
  readonly createToken?: CreateApiToken
}) {
  const router = useRouter()
  // Revocation is irreversible, so it takes a click to arm and a second to
  // commit — the same two-step pattern the settings page's delete uses.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const canCreate = viewerCan(viewer, { apiToken: ['create'] })
  const canRevoke = viewerCan(viewer, { apiToken: ['revoke'] })

  // The loader owns the list, so the hook re-runs it on success rather than
  // mirroring the revoked row into local state.
  const revoke = useServerAction(
    (tokenId: string) => revokeToken({ data: { workspaceSlug, tokenId } }),
    { failureMessage: REVOKE_FAILED }
  )

  // A revoke failure renders on the token row that produced it and is
  // cleared by the next mutation — the shared per-row failure hook, the same
  // model the webhooks panel uses, instead of a lone panel-foot alert.
  const { failure: failedRow, runWith: revokeOnRow } = useKeyedFailure<string>()

  async function revokeTokenOnRow(tokenId: string) {
    await revokeOnRow(tokenId, () => revoke.runAsync(tokenId))
  }

  return (
    <Panel>
      <CreateSection
        allowed={canCreate}
        title="Create a token"
        deniedReason="Your role cannot mint tokens."
      >
        <ApiTokenForm
          workspaceSlug={workspaceSlug}
          onCreated={async () => {
            await router.invalidate()
          }}
          {...(createToken === undefined ? {} : { createToken })}
        />
      </CreateSection>

      <ListSection
        title="Active tokens"
        footer={
          canRevoke ? undefined : (
            <p className="text-xs text-muted-foreground">
              Your role cannot revoke tokens.
            </p>
          )
        }
      >
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
                    <Identifier>{token.prefix}…</Identifier>
                  </ItemTitle>
                  <ItemDescription>
                    Created {formatUtcOr(token.createdAt, 'never')} · Last used{' '}
                    {formatUtcOr(token.lastUsedAt, 'never')}
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
                      busy={revoke.pendingInput === token.id}
                      onArm={() => setConfirmingId(token.id)}
                      onCancel={() => setConfirmingId(null)}
                      onConfirm={() => void revokeTokenOnRow(token.id)}
                    />
                  </ItemActions>
                ) : null}
                {failedRow?.key === token.id ? (
                  <ActionFeedback error={failedRow.message} />
                ) : null}
              </Item>
            ))}
          </ItemGroup>
        )}
      </ListSection>
    </Panel>
  )
}
