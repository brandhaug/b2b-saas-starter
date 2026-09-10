import { createServerFn } from '@tanstack/react-start'

import { type ClientTelemetryConfig } from './telemetry-config'

/**
 * Everything the root route needs before it can render a page: the browser
 * SDKs' public config, plus whether this request carries a session.
 *
 * One payload, one round trip. The public header is rendered by the root's
 * children on every marketing page, and it has to know whether to offer
 * "Sign in" or a way back into the app — a second server fn for one boolean
 * would double the document's server-fn traffic on every route.
 */
export type RootData = {
  readonly telemetry: ClientTelemetryConfig
  /**
   * Whether the request came from a signed-in visitor. A projection, never
   * the session: nothing about the user crosses into the root's SSR payload,
   * which every page (including unauthenticated ones) ships.
   */
  readonly signedIn: boolean
}

/** Identity-free output, so no gate applies; the session read is a probe. */
export const rootDataServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<RootData> => {
    const { readRootDataHandler } = await import('./root-data.effects')
    return readRootDataHandler()
  }
)
