import { createServerFn } from '@tanstack/react-start'

import { type SocialProviderId } from '@b2b-saas-starter/env/server'

/**
 * Providers without a `*_CLIENT_ID` / `*_CLIENT_SECRET` pair stay inactive
 * and do not render a sign-in button.
 */
export const getSocialProviderIds = createServerFn({
  method: 'GET'
}).handler(async (): Promise<ReadonlyArray<SocialProviderId>> => {
  const { readSocialProviderIdsHandler } = await import('./social-providers.effects')
  return readSocialProviderIdsHandler()
})
