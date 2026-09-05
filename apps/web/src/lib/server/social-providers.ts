import { createServerFn } from '@tanstack/react-start'

import { type SocialProviderId } from '@b2b-saas-starter/env/server'

/**
 * Social sign-in wiring for the web app, in a **client-safe** module.
 *
 * This file is statically imported by the sign-in and sign-up routes, and the
 * route tree ships to the browser — so the env-gated provider read lives in
 * `social-providers.effects.ts`, reached only through dynamic `import()`
 * inside the handler: TanStack Start strips handler bodies from the client
 * build, so the env/server graph never ships. With no `*_CLIENT_ID` /
 * `*_CLIENT_SECRET` pair set, no provider is active and the auth screens
 * render exactly as they did before social sign-in existed (provider-light
 * rule).
 */
export const getSocialProviderIds = createServerFn({
  method: 'GET'
}).handler(async (): Promise<ReadonlyArray<SocialProviderId>> => {
  const { readSocialProviderIdsHandler } = await import('./social-providers.effects')
  return readSocialProviderIdsHandler()
})
