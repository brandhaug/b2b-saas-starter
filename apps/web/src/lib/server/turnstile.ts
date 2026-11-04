import { createServerFn } from '@tanstack/react-start'

/**
 * With TURNSTILE variables unset, verification is inactive and the site key
 * is `null`, so the form requires no challenge and renders no widget (ADR 0031).
 */
export const getTurnstileSiteKey = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string | null> => {
    const { readSiteKeyHandler } = await import('./turnstile.effects')
    return readSiteKeyHandler()
  }
)
