import { unwrapAuthResult, type AuthResult } from '@/lib/auth-result'
import { authClient } from '@/lib/auth-client'

import { useAuthClientAction, useAuthClientRows } from '@/hooks/use-auth-client-rows'
import { Button } from '@/components/ui/button'
import { ActionFeedback } from '@/components/page/action-feedback'
import { Panel } from '@/components/page/panel'
import { formatTimestamp } from '@/lib/format-date'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * One Better Auth session row, narrowed to the fields this panel reads
 * (`createdAt`/`expiresAt` are `Date`s on the client's own rows).
 */
type SessionRecord = {
  readonly token: string
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly ipAddress?: string | null | undefined
  readonly userAgent?: string | null | undefined
}

/**
 * One row of the panel's own view model: a Better Auth session plus the
 * expiry label, which is formatted inside the query function (client-side
 * only) so server rendering never formats dates.
 */
type SessionRowView = {
  readonly token: string
  readonly deviceLabel: string
  readonly expiresLabel: string
  readonly ipAddress: string | null | undefined
}

function describeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) {
    return m.unknown_device()
  }
  if (userAgent.includes('iPhone') || userAgent.includes('Android')) {
    return m.mobile_browser()
  }
  if (userAgent.includes('Macintosh')) {
    return 'Mac'
  }
  if (userAgent.includes('Windows')) {
    return 'Windows'
  }
  if (userAgent.includes('Linux')) {
    return 'Linux'
  }
  return m.browser()
}

function toViewModels(sessions: ReadonlyArray<SessionRecord>): Array<SessionRowView> {
  // Formatting happens here — inside the caller's post-mount effect or action,
  // never during render — so SSR and the browser cannot disagree on the date.
  return sessions
    .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((session) => ({
      token: session.token,
      deviceLabel: describeUserAgent(session.userAgent),
      // `formatTimestamp` pins locale and zone (en-US/UTC), like every other
      // timestamp — the ambient-locale call this replaced was the one
      // remaining hydration-unsafe formatter.
      expiresLabel: formatTimestamp(session.expiresAt, { dateStyle: 'medium' }),
      ipAddress: session.ipAddress
    }))
}

/**
 * Active-session management for the signed-in user: list, revoke a single
 * other session, or "sign out everywhere else". The current session is marked
 * and cannot be revoked from here — signing out of it is the shell's
 * sign-out button.
 */
/**
 * The sessions query is shared cache, not component state — the shared
 * `useAuthClientRows` owns the how (`hooks/use-auth-client-rows.ts`).
 */
const SESSIONS_QUERY_KEY: ReadonlyArray<unknown> = ['account', 'sessions']

export function SessionsPanel({
  currentSessionToken
}: {
  readonly currentSessionToken: string
}) {
  const { hydrated, rows, loadError, isPending, refetch } = useAuthClientRows({
    queryKey: SESSIONS_QUERY_KEY,
    list: () => authClient.listSessions(),
    toRows: toViewModels,
    loadFailedMessage: m.load_sessions_failed()
  })
  // The session list is this panel's own query, not a loader's, so the action
  // refetches it rather than invalidating the route.
  const act = useAuthClientAction({
    refetch,
    call: (action: () => Promise<AuthResult<unknown>>) =>
      unwrapAuthResult(action, m.session_action_failed()),
    failureMessage: m.session_action_failed()
  })

  const othersExist = rows?.some((row) => row.token !== currentSessionToken)

  return (
    <Panel
      title={m.active_sessions()}
      description={m.active_sessions_description()}
      actions={
        othersExist ? (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" />}>
              {m.auth_sign_out_everywhere()}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>{m.auth_sign_out_everywhere()}?</AlertDialogTitle>
              <AlertDialogDescription>
                {m.other_sessions_revoked()}
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => act.run(() => authClient.revokeOtherSessions())}
                >
                  {m.sign_out()}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : undefined
      }
      footer={
        <>
          <ActionFeedback error={loadError} />
          <ActionFeedback error={act.error} />
        </>
      }
    >
      {hydrated && isPending ? (
        <ul className="grid gap-2" aria-busy="true">
          {[0, 1].map((index) => (
            <li key={index} className="rounded-sm border border-border px-3 py-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-1 h-3 w-56" />
            </li>
          ))}
        </ul>
      ) : null}
      {Array.isArray(rows) ? (
        <ul className="grid gap-2">
          {rows.map((row) => {
            const isCurrent = row.token === currentSessionToken
            return (
              <li
                key={row.token}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-sm border border-border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {row.deviceLabel}{' '}
                    {isCurrent ? (
                      <span className="text-muted-foreground">· {m.this_device()}</span>
                    ) : null}
                  </p>
                  <p className="text-xs font-mono tabular-nums text-muted-foreground">
                    {row.ipAddress ? `${row.ipAddress} · ` : ''}
                    {m.expires_label()} {row.expiresLabel}
                  </p>
                </div>
                {isCurrent ? null : (
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          variant="ghost"
                          aria-label={m.revoke_session_named({ name: row.deviceLabel })}
                        />
                      }
                    >
                      {m.action_revoke()}
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogTitle>
                        {m.revoke_session_named({ name: row.deviceLabel })}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {m.public_auth_session_signed_out()}
                      </AlertDialogDescription>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            act.run(() =>
                              authClient.revokeSession({ token: row.token })
                            )
                          }
                        >
                          {m.revoke_session_action()}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </li>
            )
          })}
        </ul>
      ) : null}
    </Panel>
  )
}
