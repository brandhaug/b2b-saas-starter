import { createIsomorphicFn } from '@tanstack/react-start'
import { pickOptionalStrings } from './utils'

export type SupportConfig = {
  readonly email?: string | undefined
  readonly helpdeskUrl?: string | undefined
  readonly helpCenterUrl?: string | undefined
  readonly appVersion?: string | undefined
}

export const loadSupportConfig = createIsomorphicFn()
  .server(async (): Promise<SupportConfig> => {
    const { readSupportConfig } = await import('./support-config.effects')
    return readSupportConfig()
  })
  .client(async (): Promise<SupportConfig> => {
    // A failed config fetch leaves diagnostic copying available.
    // oxlint-disable-next-line effect/noTryCatch -- browser fetch boundary; no Effect runtime ships to the client
    try {
      const response = await fetch('/api/support-config', { credentials: 'omit' })
      if (!response.ok) {
        return {}
      }
      return pickOptionalStrings(await response.json(), [
        'email',
        'helpdeskUrl',
        'helpCenterUrl',
        'appVersion'
      ])
    } catch {
      return {}
    }
  })
