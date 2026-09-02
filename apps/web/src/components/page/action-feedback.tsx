import { type ReactNode } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'

/**
 * The one mutation-feedback renderer: a `useServerAction` result's `error`
 * becomes the destructive alert, and optional success content becomes the
 * `ok` alert. Replaces the per-panel raw `<p role="alert">` and hand-rolled
 * destructive `Alert`s so every failure reads (and screen-reads) the same.
 */
export function ActionFeedback({
  error,
  notice
}: {
  /** The action's `error` channel, handed in whole. `null` renders nothing. */
  readonly error: string | null
  /** Success/news content, rendered in an `ok` alert when present. */
  readonly notice?: ReactNode
}) {
  return (
    <>
      {notice === undefined ? null : (
        <Alert variant="ok">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </>
  )
}
