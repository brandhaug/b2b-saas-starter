import { unwrapAuthResult, type AuthResult } from '@/lib/auth-result'
import {
  listSessionsWithAuthClient,
  revokeOtherSessionsWithAuthClient,
  revokeSessionWithAuthClient,
  type ListSessions,
  type RevokeOtherSessions,
  type RevokeSession,
  type SessionRecord
} from '@/components/auth/auth-client-ports'

import { useAuthClientAction, useAuthClientRows } from '@/hooks/use-auth-client-rows'
import { Button } from '@/components/ui/button'
import { ActionFeedback } from '@/components/page/action-feedback'
import { Panel } from '@/components/page/panel'
import { formatUtc } from '@/lib/format-date'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Skeleton } from '@/components/ui/skeleton'

export type {
  ListSessions,
  RevokeOtherSessions,
  RevokeSession
} from '@/components/auth/auth-client-ports'

/**
 * One row of the panel's own view model: a Better Auth session plus the
 * expiry label, which is formatted inside the query function (client-side
 * only) so server rendering never formats dates.
 */
export type SessionRowView = {
  readonly token: string
  readonly deviceLabel: string
  readonly expiresLabel: string
  readonly ipAddress: string | null | undefined
}

function describeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) {
    return 'Unknown device'
  }
  if (userAgent.includes('iPhone') || userAgent.includes('Android')) {
    return 'Mobile browser'
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
  return 'Browser'
}

function toViewModels(sessions: ReadonlyArray<SessionRecord>): Array<SessionRowView> {
  // Formatting happens here — inside the caller's post-mount effect or action,
  // never during render — so SSR and the browser cannot disagree on the date.
  return sessions
    .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((session) => ({
      token: session.token,
      deviceLabel: describeUserAgent(session.userAgent),
      // `formatUtc` pins locale and zone (en-US/UTC), like every other
      // timestamp — the ambient-locale call this replaced was the one
      // remaining hydration-unsafe formatter.
      expiresLabel: formatUtc(session.expiresAt, { dateStyle: 'medium' }),
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
const ACTION_FAILED = 'The change could not be made'

export function SessionsPanel({
  currentSessionToken,
  listSessions = listSessionsWithAuthClient,
  revokeSession = revokeSessionWithAuthClient,
  revokeOtherSessions = revokeOtherSessionsWithAuthClient
}: {
  readonly currentSessionToken: string
  readonly listSessions?: ListSessions
  readonly revokeSession?: RevokeSession
  readonly revokeOtherSessions?: RevokeOtherSessions
}) {
  const { hydrated, rows, loadError, isPending, refetch } = useAuthClientRows({
    queryKey: SESSIONS_QUERY_KEY,
    list: listSessions,
    toRows: toViewModels,
    loadFailedMessage: 'Could not load sessions'
  })
  // The session list is this panel's own query, not a loader's, so the action
  // refetches it rather than invalidating the route.
  const act = useAuthClientAction({
    refetch,
    call: (action: () => Promise<AuthResult<unknown>>) =>
      unwrapAuthResult(action, ACTION_FAILED),
    failureMessage: ACTION_FAILED
  })

  const othersExist = rows?.some((row) => row.token !== currentSessionToken)

  return (
    <Panel
      title="Active sessions"
      description="Every device currently signed in as you. Revoking a session signs it out immediately."
      actions={
        othersExist ? (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
              Sign out everywhere else
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Sign out everywhere else?</AlertDialogTitle>
              <AlertDialogDescription>
                Every session except this device will be revoked.
              </AlertDialogDescription>
              <div className="flex justify-end gap-2">
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => act.run(() => revokeOtherSessions())}>
                  Sign out
                </AlertDialogAction>
              </div>
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
                      <span className="text-muted-foreground">· This device</span>
                    ) : null}
                  </p>
                  <p className="text-xs font-mono tabular-nums text-muted-foreground">
                    {row.ipAddress ? `${row.ipAddress} · ` : ''}Expires{' '}
                    {row.expiresLabel}
                  </p>
                </div>
                {isCurrent ? null : (
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Revoke ${row.deviceLabel} session`}
                        />
                      }
                    >
                      Revoke
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogTitle>
                        Revoke the {row.deviceLabel} session?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        That device will be signed out.
                      </AlertDialogDescription>
                      <div className="flex justify-end gap-2">
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            act.run(() => revokeSession({ token: row.token }))
                          }
                        >
                          Revoke session
                        </AlertDialogAction>
                      </div>
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
