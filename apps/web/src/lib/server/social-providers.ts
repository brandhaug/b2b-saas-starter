import { createServerFn } from '@tanstack/react-start'

import { type SocialProviderId } from '@b2b-saas-starter/env/server'

/**
 * Social sign-in wiring for the web app, in a **client-safe** module: the
 * client-safe half of the `social-providers.effects.ts` split (see
 * apps/web/AGENTS.md for the rule and `assert-client-boundary.mjs` for the
 * enforcement). With no `*_CLIENT_ID` / `*_CLIENT_SECRET` pair set, no
 * provider is active and the auth screens render exactly as they did before
 * social sign-in existed (provider-light rule).
 */
export const getSocialProviderIds = createServerFn({
  method: 'GET'
}).handler(async (): Promise<ReadonlyArray<SocialProviderId>> => {
  const { readSocialProviderIdsHandler } = await import('./social-providers.effects')
  return readSocialProviderIdsHandler()
})
