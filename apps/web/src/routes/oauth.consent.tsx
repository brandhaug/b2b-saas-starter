import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { PlugZapIcon } from 'lucide-react'
import { AuthCardForm } from '@/components/auth/auth-card-form'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import { consentRequest, scopeLabel } from '@/lib/oauth-query'
import { pageTitle } from '@/components/page/page-title'
import { requireSession } from '@/lib/server/auth'
import {
  denyOAuthConsentServerFn,
  grantOAuthConsentServerFn,
  loadOAuthConsentServerFn,
  type OAuthConsentPayload,
  type OAuthRedirect
} from '@/lib/server/mcp-consent'
import { callServerFn } from '@/lib/server-call'
import { pickOptionalStrings } from '@/lib/utils'

/**
 * The OAuth consent page (ADR 0055): an MCP client has asked to connect, the
 * user is signed in, and two things are decided here — which one Workspace the
 * client gets, and whether the requested scopes are acceptable. The provider
 * sends every authorization here (it is both its post-login and consent hop),
 * so the pick is made per authorization, never remembered.
 *
 * Like `/account`, this lives outside `/workspaces`: there is no workspace in
 * the URL yet — choosing one is the point.
 */
export const Route = createFileRoute('/oauth/consent')({
  // The provider's redirect carries the whole signed authorization request;
  // the page reads two fields of it for display and hands the signed query
  // back verbatim on submit.
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the router's search record is untyped at this boundary; see pickOptionalStrings
  validateSearch: (search: unknown) =>
    pickOptionalStrings(search, ['client_id', 'scope']),
  loaderDeps: ({ search }) => ({ clientId: search.client_id ?? '' }),
  beforeLoad: async ({ location }) => {
    const session = await requireSession(location.href)
    return { session }
  },
  loader: ({ deps }) => loadOAuthConsentServerFn({ data: { clientId: deps.clientId } }),
  component: OAuthConsentRoute,
  head: () => ({ meta: [{ title: pageTitle('Connect an MCP client') }] })
})
/** The page's two server calls, as ports — a test drives the page with plain functions. */
export type GrantConsent = (input: {
  readonly data: { readonly workspaceId: string; readonly oauthQuery: string }
}) => Promise<OAuthRedirect>
export type DenyConsent = (input: {
  readonly data: { readonly oauthQuery: string }
}) => Promise<OAuthRedirect>

function OAuthConsentRoute() {
  const payload = Route.useLoaderData()
  const search = Route.useSearch()
  return (
    <OAuthConsentPage
      payload={payload}
      request={consentRequest(search)}
      grant={grantOAuthConsentServerFn}
      deny={denyOAuthConsentServerFn}
    />
  )
}

const GRANT_FAILED = 'The connection could not be authorized'
const DENY_FAILED = 'The request could not be declined'

/** What `callServerFn` folds a server call into — restated so `grantPicked`'s refusal shares the shape without a promise wrapper. */
type ConsentOutcome =
  | { readonly ok: true; readonly value: OAuthRedirect }
  | {
      readonly ok: false
      readonly message: string
    }

/** Where the browser goes with the provider's answer — injected so a test can watch it. */
function assignLocation(url: string) {
  window.location.assign(url)
}

export function OAuthConsentPage({
  payload,
  request,
  grant,
  deny,
  assign = assignLocation
}: {
  readonly payload: OAuthConsentPayload
  readonly request: ReturnType<typeof consentRequest>
  readonly grant: GrantConsent
  readonly deny: DenyConsent
  /** Where the browser goes with the provider's answer — injected so a test can watch it. */
  readonly assign?: (url: string) => void
}) {
  const oauthQuery = payload.oauthQuery
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    payload.workspaces.length === 1
      ? (payload.workspaces[0]?.workspace.id ?? null)
      : null
  )
  const [pending, setPending] = useState<'grant' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const clientName = payload.client?.name ?? request?.clientId ?? 'An MCP client'
  const canGrant = request !== null && oauthQuery !== null && workspaceId !== null

  async function decide(action: 'grant' | 'deny') {
    if (oauthQuery === null) {
      setError('This page was opened without an authorization request.')
      return
    }
    setPending(action)
    setError(null)
    const outcome =
      action === 'deny'
        ? await callServerFn(() => deny({ data: { oauthQuery } }), DENY_FAILED)
        : await grantPicked(oauthQuery)
    if (!outcome.ok) {
      setPending(null)
      setError(outcome.message)
      return
    }
    assign(outcome.value.url)
  }

  /**
   * The grant half, kept apart from `deny` so the two verbs can never bleed
   * into each other: a grant arriving without a picked workspace refuses
   * with a reason instead of declining the request the user just accepted.
   */
  async function grantPicked(query: string): Promise<ConsentOutcome> {
    if (workspaceId === null) {
      // The Allow control is disabled without a pick; this is the honest
      // answer if one ever gets through.
      return { ok: false, message: 'Pick the workspace to connect first.' }
    }
    return callServerFn(
      () => grant({ data: { workspaceId, oauthQuery: query } }),
      GRANT_FAILED
    )
  }

  return (
    <AuthCardForm
      title={`Connect ${clientName}`}
      description={
        payload.client?.uri ? (
          <>
            <span className="font-mono text-xs">{payload.client.uri}</span> wants to
            connect to one of your workspaces through the MCP server.
          </>
        ) : (
          'An MCP client wants to connect to one of your workspaces through the MCP server.'
        )
      }
      form={null}
      error={error}
    >
      {request === null ? (
        <p role="alert" className="text-sm text-destructive">
          This page was opened without an authorization request. Start the connection
          from your MCP client again.
        </p>
      ) : (
        <>
          <section className="grid gap-2" aria-labelledby="consent-workspace">
            <h2 id="consent-workspace" className="text-sm font-medium">
              Workspace
            </h2>
            {payload.workspaces.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Your account is not a member of any workspace yet. Create or join one,
                then start the connection again.
              </p>
            ) : (
              <RadioGroup
                value={workspaceId}
                onValueChange={(value) => setWorkspaceId(String(value))}
                aria-label="Workspace to connect"
              >
                {payload.workspaces.map(({ workspace, memberCount }) => (
                  <Label
                    key={workspace.id}
                    className="flex items-start gap-3 rounded-sm border border-border px-3 py-2 has-data-checked:border-primary"
                  >
                    <RadioGroupItem value={workspace.id} className="mt-0.5" />
                    <span className="grid gap-0.5">
                      <span className="text-sm">{workspace.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {workspace.slug} ·{' '}
                        <span className="font-mono tabular-nums">{memberCount}</span>{' '}
                        {memberCount === 1 ? 'member' : 'members'}
                      </span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            )}
            <p className="text-xs text-muted-foreground">
              The client sees exactly one workspace, with what your role there allows.
              Nothing else on your account.
            </p>
          </section>

          <section className="grid gap-2" aria-labelledby="consent-scopes">
            <h2 id="consent-scopes" className="text-sm font-medium">
              The client asks to
            </h2>
            <ul className="grid gap-1 text-sm">
              {request.scopes.map((scope) => (
                <li key={scope} className="flex items-baseline gap-2">
                  <PlugZapIcon className="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground" />
                  <span>
                    {scopeLabel(scope)}{' '}
                    <span className="font-mono text-xs text-muted-foreground">
                      {scope}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending !== null || oauthQuery === null}
              onClick={() => void decide('deny')}
            >
              {pending === 'deny' ? <Spinner /> : null}
              Decline
            </Button>
            <Button
              type="button"
              disabled={!canGrant || pending !== null}
              onClick={() => void decide('grant')}
            >
              {pending === 'grant' ? <Spinner /> : null}
              Allow access
            </Button>
          </div>
        </>
      )}
    </AuthCardForm>
  )
}
