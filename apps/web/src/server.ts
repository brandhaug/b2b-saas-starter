import {
  makeSentryOptions,
  wireWideEventProviders
} from '@b2b-saas-starter/logger/providers'
import StartServerEntry from '@tanstack/react-start/server-entry'
import { env as cloudflareEnv } from 'cloudflare:workers'
import * as Sentry from '@sentry/cloudflare'

// The TanStack Start entry's `fetch` carries Start's own handler signature;
// the adapter below re-shapes it into a plain Workers `ExportedHandler` so
// `Sentry.withSentry` can wrap it at the platform boundary.
const worker = {
  fetch(request: Request): Promise<Response> | Response {
    return StartServerEntry.fetch(request)
  }
}

export default Sentry.withSentry(() => {
  // Point the wide-event sinks (Sentry errors, PostHog events) at this
  // invocation's env; unset vars keep both providers fully inert. Runs per
  // request so a binding added between requests takes effect without an
  // isolate restart. See packages/logger/src/providers.ts.
  wireWideEventProviders(cloudflareEnv)
  // Without SENTRY_DSN this returns empty options and the SDK initializes a
  // disabled client — provider-light deployments are unchanged.
  return makeSentryOptions('web', cloudflareEnv)
}, worker)
