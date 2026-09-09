import { type ApiToken } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { useState, useSyncExternalStore } from 'react'
import { useRouter } from '@tanstack/react-router'

import { ApiTokenForm, type CreateApiToken } from '@/components/api-token-form'
import {
  ApiTokenReplacementForm,
  type ReplaceApiToken
} from '@/components/api-token-replacement-form'
import { Button } from '@/components/ui/button'
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
import { CreateAction, ListSection, Panel } from '@/components/page/panel'
import { Identifier } from '@/components/page/identifier'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { formatTimestampOr } from '@/lib/format-date'
import { viewerCan, type Viewer } from '@/lib/permissions'
import { revokeApiTokenServerFn } from '@/lib/server/api-tokens'
import { useKeyedFailure } from '@/hooks/use-keyed-failure'
import { useServerAction } from '@/hooks/use-server-action'
import { m } from '@b2b-saas-starter/i18n/messages'

function subscribeClock(onChange: () => void) {
  const timer = window.setInterval(onChange, 1000)
  return () => window.clearInterval(timer)
}
function clockSnapshot() {
  return Math.floor(Date.now() / 1000) * 1000
}
function serverClockSnapshot() {
  return 0
}

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
  createToken,
  replaceToken,
  creation = 'visible'
}: {
  readonly workspaceSlug: string
  readonly tokens: ReadonlyArray<ApiToken>
  readonly viewer: Viewer
  readonly revokeToken?: RevokeApiToken
  readonly replaceToken?: ReplaceApiToken
  readonly createToken?: CreateApiToken
  readonly creation?: 'visible' | 'hidden'
}) {
  const router = useRouter()
  const now = useSyncExternalStore(subscribeClock, clockSnapshot, serverClockSnapshot)
  const [replacing, setReplacing] = useState<ApiToken | null>(null)
  // Revocation is irreversible, so it takes a click to arm and a second to
  // commit — the same two-step pattern the settings page's delete uses.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const canCreate =
    creation === 'visible' && viewerCan(viewer, { apiToken: ['create'] })
  const canRevoke = viewerCan(viewer, { apiToken: ['revoke'] })

  // The loader owns the list, so the hook re-runs it on success rather than
  // mirroring the revoked row into local state.
  const revoke = useServerAction(
    (tokenId: string) => revokeToken({ data: { workspaceSlug, tokenId } }),
    { failureMessage: m.api_token_revoke_failed() }
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
      {creation === 'visible' ? (
        <CreateAction
          allowed={canCreate}
          title={m.tokens_create_title()}
          deniedReason={m.token_mint_denied()}
        >
          <ApiTokenForm
            workspaceSlug={workspaceSlug}
            onCreated={async () => {
              await router.invalidate()
            }}
            {...(createToken === undefined ? {} : { createToken })}
          />
        </CreateAction>
      ) : null}

      {replacing ? (
        <ApiTokenReplacementForm
          key={replacing.id}
          workspaceSlug={workspaceSlug}
          token={replacing}
          onReplaced={() => router.invalidate()}
          onClose={() => setReplacing(null)}
          {...(replaceToken === undefined ? {} : { replaceToken })}
        />
      ) : null}
      <ListSection
        as="h2"
        title={m.tokens_title()}
        footer={
          canRevoke ? undefined : (
            <p className="text-xs text-muted-foreground">{m.token_revoke_denied()}</p>
          )
        }
      >
        {tokens.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{m.empty_no_tokens()}</EmptyTitle>
              <EmptyDescription>{m.empty_create_token()}</EmptyDescription>
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
                    {m.token_created_label()}{' '}
                    {formatTimestampOr(token.createdAt, m.never())} ·{' '}
                    {m.token_last_used_label()}{' '}
                    {formatTimestampOr(token.lastUsedAt, m.never())}
                  </ItemDescription>
                  <ItemDescription>
                    {token.expiresAt !== null && Date.parse(token.expiresAt) <= now
                      ? m.token_expired()
                      : m.token_expires()}{' '}
                    {formatTimestampOr(token.expiresAt, m.never())}
                    {token.replacedByTokenId === null
                      ? null
                      : ` · ${m.token_replacement_issued()}`}
                  </ItemDescription>
                  <div className="flex flex-wrap gap-1">
                    {token.scopes.map((scope) => (
                      <Badge key={scope} variant="outline">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                </ItemContent>
                <ItemActions>
                  {canCreate &&
                  token.replacedByTokenId === null &&
                  (token.expiresAt === null || Date.parse(token.expiresAt) > now) ? (
                    <Button
                      variant="outline"
                      disabled={replacing !== null}
                      onClick={() => setReplacing(token)}
                    >
                      {m.action_replace()}
                    </Button>
                  ) : null}
                  {canRevoke ? (
                    <ConfirmButton
                      label={m.action_revoke()}
                      confirmLabel={m.action_confirm_revoke()}
                      armed={confirmingId === token.id}
                      busy={revoke.pendingInput === token.id}
                      onArm={() => setConfirmingId(token.id)}
                      onCancel={() => setConfirmingId(null)}
                      onConfirm={() => void revokeTokenOnRow(token.id)}
                    />
                  ) : null}
                </ItemActions>
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
