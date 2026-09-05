import {
  activeSocialProviders,
  SOCIAL_PROVIDER_IDS,
  type SocialProviderId
} from '@b2b-saas-starter/env/server'
import { env } from 'cloudflare:workers'

/**
 * Social sign-in's server-only read, reached only through dynamic `import()`
 * inside the handler of `social-providers.ts` (see apps/web/AGENTS.md): the
 * env/server vocabulary pins the Effect graph, which must never ship to the
 * browser.
 */

/**
 * The handler `getSocialProviderIds` delegates to. The client secret must
 * never cross the server-function boundary, so what crosses is the ordered
 * list of active provider ids — nothing else. `activeSocialProviders` is the
 * shared "both halves present" decision (`@b2b-saas-starter/env`), so the
 * auth config and the UI can never disagree about which providers exist.
 */
export function readSocialProviderIdsHandler(): ReadonlyArray<SocialProviderId> {
  const providers = activeSocialProviders(env)
  return SOCIAL_PROVIDER_IDS.filter((id) => providers[id] !== undefined)
}
