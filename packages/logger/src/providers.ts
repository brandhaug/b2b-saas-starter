/** Native Workers Logs operational signals. */
// Promise-native Worker entry adapters preserve the original operation result.
// oxlint-disable effect/noAsyncFunction, effect/noTryCatch, effect/noNewPromise, effect/noGlobals, eslint/no-console
import { diagnosticFields, diagnosticLabel } from './sanitization.ts'

/** Completion events support freshness queries; failure still rejects the invocation. */
export async function withCronMonitor<A>(
  monitorSlug: string,
  operation: () => Promise<A>
): Promise<A> {
  const event = { event: 'cron.check_in', monitorSlug: diagnosticLabel(monitorSlug) }
  console.log(JSON.stringify({ ...event, status: 'in_progress' }))
  try {
    const result = await operation()
    console.log(JSON.stringify({ ...event, status: 'ok' }))
    return result
  } catch (error) {
    console.error(JSON.stringify({ ...event, status: 'error' }))
    // oxlint-disable-next-line effect/noThrowStatement -- preserve the platform invocation failure
    throw error
  }
}

/** Include zero values so alert queries can observe recovery. */
export function captureOperationalSnapshot(
  values: Readonly<Record<string, number>>
): Promise<void> {
  console.log(
    JSON.stringify({ event: 'operations.snapshot', service: 'background', values })
  )
  return Promise.resolve()
}

/** Error severity feeds Workers Issues; customer content stays out of evidence. */
export function captureMonitoringSignal(
  signal: string,
  evidence: Readonly<Record<string, string | number | undefined>>
): Promise<void> {
  console.error(
    JSON.stringify({
      event: 'operations.failure',
      signal: diagnosticLabel(signal),
      evidence: diagnosticFields(evidence)
    })
  )
  return Promise.resolve()
}
