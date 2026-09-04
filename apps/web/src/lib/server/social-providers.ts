import {
  activeSocialProviders,
  SOCIAL_PROVIDER_IDS,
  type SocialProviderId
} from '@b2b-saas-starter/env/server'
import { env } from 'cloudflare:workers'
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'

/**
 * Social sign-in wiring for the web app: which providers the sign-in and
 * sign-up screens may offer. Env-gated like Turnstile — with no
 * `*_CLIENT_ID`/`*_CLIENT_SECRET` pair set, no provider is active and the
 * auth screens render exactly as they did before social sign-in existed
 * (provider-light rule).
 */

// Server-only read: the client secret must never cross the server-function
// boundary, so what crosses is the ordered list of active provider ids —
// nothing else. `activeSocialProviders` is the shared "both halves present"
// decision (`@b2b-saas-starter/env`), so the auth config and the UI can never
// disagree about which providers exist.
const readSocialProviderIds = createServerOnlyFn(
  (): ReadonlyArray<SocialProviderId> => {
    const providers = activeSocialProviders(env)
    return SOCIAL_PROVIDER_IDS.filter((id) => providers[id] !== undefined)
  }
)

export const getSocialProviderIds = createServerFn({ method: 'GET' }).handler(
  readSocialProviderIds
)
