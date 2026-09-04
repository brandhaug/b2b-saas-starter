import { useQuery, type QueryObserverResult } from '@tanstack/react-query'
import { useHydrated } from '@/lib/client-only-value'
import { type AuthResult } from '@/lib/auth-result'
import { useServerAction, type ServerAction } from '@/hooks/use-server-action'

/** What `useAuthClientRows` hands a panel: the list read, ready to render. */
type AuthClientRows<Row> = {
  readonly hydrated: boolean
  readonly rows: ReadonlyArray<Row> | undefined
  readonly loadError: string | null
  readonly isPending: boolean
  readonly refetch: () => Promise<QueryObserverResult>
}

/**
 * The list machinery the Better Auth account panels share (`SessionsPanel`,
 * `PasskeysPanel`, `LinkedAccountsPanel`): wait for hydration (the Better Auth
 * client endpoint is browser-only — a relative fetch — so the server render
 * must not fetch), read the list once per key through TanStack Query with no
 * retry, map the records onto the panel's own view model, and fold a failed
 * read into a displayable `loadError`.
 *
 * The rows are shared cache, not component state: deduplicated concurrent
 * reads and cross-mount caching mean a panel renders from cache on revisits
 * instead of re-fetching after every hydration.
 */
export function useAuthClientRows<Record, Row>({
  queryKey,
  list,
  toRows,
  loadFailedMessage
}: {
  readonly queryKey: ReadonlyArray<unknown>
  readonly list: () => Promise<AuthResult<ReadonlyArray<Record>>>
  readonly toRows: (records: ReadonlyArray<Record>) => Array<Row>
  readonly loadFailedMessage: string
}): AuthClientRows<Row> {
  const hydrated = useHydrated()
  const {
    data: rows,
    error: queryError,
    isPending,
    refetch
  } = useQuery({
    queryKey,
    queryFn: async (): Promise<Array<Row>> => {
      const result = await list()
      if (result.error) {
        // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- TanStack Query surfaces failure states by rejecting the query function; there is no Effect channel here
        throw new Error(result.error.message ?? loadFailedMessage)
      }
      return toRows(result.data ?? [])
    },
    enabled: hydrated,
    retry: false
  })

  return {
    hydrated,
    rows,
    loadError: queryError?.message ?? null,
    isPending,
    refetch
  }
}

/**
 * The panels' shared mutation wrapper, the `useServerAction` half of the list
 * machinery: the list is the panel's own query rather than a loader's, so the
 * action never invalidates the route and refetches the list on success, after
 * any caller-provided `onSuccess`. A hook beside its host (call it
 * unconditionally at the panel's top level, once per action).
 */
export function useAuthClientAction<Input, ActionValue>({
  refetch,
  call,
  failureMessage,
  onSuccess
}: {
  readonly refetch: () => Promise<QueryObserverResult>
  readonly call: (input: Input) => Promise<ActionValue>
  readonly failureMessage: string
  readonly onSuccess?: (value: ActionValue, input: Input) => void | Promise<void>
}): ServerAction<Input, ActionValue> {
  return useServerAction(call, {
    failureMessage,
    invalidate: false,
    onSuccess: async (value, input) => {
      await onSuccess?.(value, input)
      await refetch()
    }
  })
}
