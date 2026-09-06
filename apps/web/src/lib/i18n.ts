import { createIsomorphicFn } from '@tanstack/react-start'
import { requestPresentation } from './server/i18n-context'

/** The same presentation settings are used for SSR and the hydration render. */
export const presentationSettings = createIsomorphicFn()
  .server(() => requestPresentation())
  .client(() => ({
    timeZone: document.documentElement.dataset.timeZone ?? 'UTC',
    authenticated: document.documentElement.dataset.authenticated === 'true',
    needsTimeZone: document.documentElement.dataset.needsTimeZone === 'true'
  }))
