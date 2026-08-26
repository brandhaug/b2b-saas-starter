import { LaptopIcon } from 'lucide-react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { authClient } from '@/lib/auth-client'
import { useHydrated } from '@/lib/client-only-value'
import { Button } from '@/components/ui/button'
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

export type SessionRecord = {
  readonly token: string
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly ipAddress?: string | null | undefined
  readonly userAgent?: string | null | undefined
}

/**
 * The three Better Auth session endpoints this panel drives, as ports.
 * Injected rather than reaching for the `authClient` singleton at the call
 * site so a test drives the panel with real functions of these shapes instead
 * of replacing `@/lib/auth-client`.
 */
export type ListSessions = () => Promise<{
  readonly data?: readonly SessionRecord[] | null
  readonly error?: { readonly message?: string | undefined } | null
}>

export type RevokeSession = (input: { readonly token: string }) => Promise<{
  readonly error?: { readonly message?: string | undefined } | null
}>

/** Better Auth's "revoke all sessions except the current one". */
export type RevokeOtherSessions = () => Promise<{
  readonly error?: { readonly message?: string | undefined } | null
}>

function listSessionsWithAuthClient(): ReturnType<ListSessions> {
  return authClient.listSessions()
}

function revokeSessionWithAuthClient(input: Parameters<RevokeSession>[0]) {
  return authClient.revokeSession(input)
}

function revokeOtherSessionsWithAuthClient() {
  return authClient.revokeOtherSessions()
}

function describeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device'
  if (userAgent.includes('iPhone') || userAgent.includes('Android')) {
    return 'Mobile browser'
  }
  if (userAgent.includes('Macintosh')) return 'Mac'
  if (userAgent.includes('Windows')) return 'Windows'
  if (userAgent.includes('Linux')) return 'Linux'
  return 'Browser'
}

function toViewModels(sessions: readonly SessionRecord[]): SessionRowView[] {
  // Formatting happens here — inside the caller's post-mount effect or action,
  // never during render — so SSR and the browser cannot disagree on the date.
  return sessions
    .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((session) => ({
      token: session.token,
      deviceLabel: describeUserAgent(session.userAgent),
      expiresLabel: session.expiresAt.toLocaleDateString(undefined, {
        dateStyle: 'medium',
        timeZone: 'UTC'
      }),
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
 * The sessions query is shared cache, not component state: TanStack Query
 * deduplicates concurrent reads and keeps the list across mounts, so the
 * panel renders from cache on revisits instead of re-fetching after every
 * hydration. `enabled` waits for hydration — the Better Auth client endpoint
 * is browser-only (relative fetch), so the server render must not fetch.
 */
const SESSIONS_QUERY_KEY: readonly unknown[] = ['account', 'sessions']

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
  const hydrated = useHydrated()
  const {
    data: rows,
    error: queryError,
    refetch
  } = useQuery({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: async (): Promise<readonly SessionRowView[]> => {
      const result = await listSessions()
      if (result.error) {
        // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- TanStack Query surfaces failure states by rejecting the query function; there is no Effect channel here
        throw new Error(result.error.message ?? 'Could not load sessions')
      }
      return toViewModels(result.data ?? [])
    },
    enabled: hydrated,
    retry: false
  })
  const loadError = queryError?.message ?? null
  const [actionError, setActionError] = useState<string | null>(null)

  async function act(
    action: () => Promise<{
      readonly error?: { readonly message?: string | undefined } | null
    }>
  ) {
    setActionError(null)
    const result = await action()
    if (result.error) {
      setActionError(result.error.message ?? 'The change could not be made')
      return
    }
    void refetch()
  }

  const othersExist = rows?.some((row) => row.token !== currentSessionToken)

  return (
    <section className="grid gap-4" aria-label="Active sessions">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LaptopIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Active sessions</h3>
        </div>
        {othersExist ? (
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
                <AlertDialogAction
                  onClick={() => void act(() => revokeOtherSessions())}
                >
                  Sign out
                </AlertDialogAction>
              </div>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </header>

      {loadError ? (
        <p role="alert" className="text-xs text-destructive">
          {loadError}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="text-xs text-destructive">
          {actionError}
        </p>
      ) : null}

      {rows === null && !loadError ? (
        <ul className="grid gap-2" aria-busy="true">
          {[0, 1].map((index) => (
            <li key={index} className="rounded-sm border border-border px-3 py-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-1 h-3 w-56" />
            </li>
          ))}
        </ul>
      ) : null}
      {rows === null ? null : (
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
                            void act(() => revokeSession({ token: row.token }))
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
      )}
    </section>
  )
}
