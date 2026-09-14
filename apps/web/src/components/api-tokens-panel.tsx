import { type ApiToken } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { Fragment, useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { MoreHorizontalIcon } from 'lucide-react'

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
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ConfirmButton } from '@/components/confirm-button'
import { ActionFeedback } from '@/components/page/action-feedback'
import { CreateAction, Panel } from '@/components/page/panel'
import { Identifier } from '@/components/page/identifier'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle
} from '@/components/ui/empty'
import { formatTimestampOr } from '@/lib/format-date'
import { viewerCan, type Viewer } from '@/lib/permissions'
import { revokeApiTokenServerFn } from '@/lib/server/api-tokens'
import { useKeyedFailure } from '@/hooks/use-keyed-failure'
import { useServerAction } from '@/hooks/use-server-action'
import { m } from '@b2b-saas-starter/i18n/messages'
import {
  DeveloperListPagination,
  DeveloperListToolbar
} from '@/components/developer-list-controls'
import { useDeveloperListView } from '@/lib/developer-list'
import { applyTableView, type TableViewField } from '@/lib/table-view'
import { useWorkspaceView } from '@/lib/workspace-view'

function tokenListFields(): ReadonlyArray<TableViewField> {
  return [
    { id: 'name', label: m.developer_list_name(), kind: 'text' },
    { id: 'prefix', label: m.token_prefix(), kind: 'text' },
    {
      id: 'status',
      label: m.common_status(),
      kind: 'select',
      options: [
        { value: 'active', label: m.developer_list_active() },
        { value: 'expired', label: m.developer_list_expired() },
        { value: 'replaced', label: m.developer_list_replaced() },
        { value: 'unused', label: m.developer_list_unused() }
      ]
    },
    { id: 'createdAt', label: m.token_created_label(), kind: 'date' },
    { id: 'lastUsedAt', label: m.developer_list_last_used(), kind: 'date' }
  ]
}

/**
 * The clock the expiry copy reads. Nothing on this panel changes between two
 * expiries, so instead of ticking every second it advances only when a token
 * actually crosses its `expiresAt`: one timer armed for the earliest future
 * expiry, rearmed for the one after it, plus a recheck on focus and
 * visibility because a backgrounded tab throttles timers and fires them late.
 *
 * `0` is the server and pre-hydration value, so nothing renders as expired
 * until the browser has a real clock and the hydrated markup matches the SSR
 * output.
 *
 * The deadlines travel through the effect as a joined string: a fresh array
 * every render would rearm the timer every render.
 */
const MAX_TIMER_DELAY = 86_400_000

function useExpiryClock(tokens: ReadonlyArray<ApiToken>): number {
  const [now, setNow] = useState(0)
  const parsed: Array<number> = []
  for (const token of tokens) {
    if (token.expiresAt !== null) {
      const at = Date.parse(token.expiresAt)
      if (!Number.isNaN(at)) {
        parsed.push(at)
      }
    }
  }
  const deadlines = parsed.join(',')

  useEffect(() => {
    const expiries = deadlines === '' ? [] : deadlines.split(',').map(Number)
    let timer = 0
    function sync() {
      const current = Date.now()
      setNow((previous) =>
        // A render is only worth it when an expiry sits between the clock the
        // list was drawn with and the clock now.
        expiries.some((at) => at > previous && at <= current) ? current : previous
      )
      window.clearTimeout(timer)
      const next = expiries.filter((at) => at > current).toSorted((a, b) => a - b)[0]
      if (next !== undefined) {
        // `setTimeout` reads its delay as a signed 32-bit value: anything past
        // ~24.8 days fires at once, and a token expiring next year would spin
        // this loop. Sleep at most a day at a time; `sync` recomputes `next`
        // when it wakes.
        timer = window.setTimeout(sync, Math.min(next - current + 1, MAX_TIMER_DELAY))
      }
    }
    sync()
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [deadlines])

  return now
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
  const now = useExpiryClock(tokens)
  const fields = tokenListFields()
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

  const list = useDeveloperListView({
    key: 'api-tokens',
    fields
  })
  const { update } = useWorkspaceView()
  const filteredTokens = (() => {
    const needle = list.query.trim().toLocaleLowerCase()
    const searched = tokens.filter((token) => {
      return (
        needle === '' ||
        `${token.name} ${token.prefix}`.toLocaleLowerCase().includes(needle)
      )
    })
    return applyTableView(searched, list.tableView, (token, field) => {
      const expired = token.expiresAt !== null && Date.parse(token.expiresAt) <= now
      let status = 'active'
      if (token.replacedByTokenId !== null) {
        status = 'replaced'
      } else if (expired) {
        status = 'expired'
      }
      if (field === 'status') {
        return status
      }
      if (field === 'createdAt') {
        return new Date(token.createdAt)
      }
      if (field === 'lastUsedAt') {
        return token.lastUsedAt === null ? null : new Date(token.lastUsedAt)
      }
      if (field === 'prefix') {
        return token.prefix
      }
      return token.name
    })
  })()
  const { page, pageCount } = list.pageFor(filteredTokens.length)
  const visibleTokens = filteredTokens.slice(
    (page - 1) * list.pageSize,
    page * list.pageSize
  )

  return (
    // No panel heading: the page header's h1 already says "API tokens", and
    // the create action belongs on that same title row rather than floating
    // above a second copy of the name.
    <Panel
      actions={
        creation === 'visible' ? (
          <CreateAction
            action="create"
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
        ) : undefined
      }
      footer={
        canRevoke ? undefined : (
          <p className="text-xs text-muted-foreground">{m.token_revoke_denied()}</p>
        )
      }
    >
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
      {tokens.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{m.empty_no_tokens()}</EmptyTitle>
            <EmptyDescription>{m.empty_create_token()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <DeveloperListToolbar
            query={list.query}
            searchLabel={m.developer_list_search_tokens()}
            fields={fields}
            view={list.tableView}
            onViewChange={list.setTableView}
          />
          {visibleTokens.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{m.developer_list_no_matching_tokens()}</EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    update({ query: undefined, tableViews: undefined, page: undefined })
                  }
                >
                  {m.developer_list_clear_all()}
                </Button>
              </EmptyContent>
            </Empty>
          ) : null}
          {visibleTokens.length === 0 ? null : (
            <ItemGroup className="gap-0">
              {visibleTokens.map((token, index) => (
                <Fragment key={token.id}>
                  <Item size="sm" className="border-0 px-0 py-4">
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
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={m.developer_list_more_actions_named({
                                name: token.name
                              })}
                            />
                          }
                        >
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {canCreate &&
                          token.replacedByTokenId === null &&
                          (token.expiresAt === null ||
                            Date.parse(token.expiresAt) > now) ? (
                            <DropdownMenuItem onClick={() => setReplacing(token)}>
                              {m.action_replace()}
                            </DropdownMenuItem>
                          ) : null}
                          {canRevoke ? (
                            <DropdownMenuItem onClick={() => setConfirmingId(token.id)}>
                              {m.action_revoke()}
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      {canRevoke && confirmingId === token.id ? (
                        <ConfirmButton
                          // Tinted, not filled: revocation is destructive, and
                          // the plain-foreground default read as less consequential
                          // than the secondary "Replace" beside it.
                          variant="destructive"
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
                  {index < visibleTokens.length - 1 ? <Separator /> : null}
                </Fragment>
              ))}
            </ItemGroup>
          )}
          {visibleTokens.length === 0 ? null : (
            <DeveloperListPagination page={page} pageCount={pageCount} />
          )}
        </>
      )}
    </Panel>
  )
}
