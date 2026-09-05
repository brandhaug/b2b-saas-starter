import { createServerFn } from '@tanstack/react-start'

/**
 * Turnstile wiring for the web app (ADR 0031), in a **client-safe** module:
 * the client-safe half of the `turnstile.effects.ts` split (see
 * apps/web/AGENTS.md for the rule and `assert-client-boundary.mjs` for the
 * enforcement). Both halves stay env-gated: with the TURNSTILE variables
 * unset the layer verifies nothing (the capability reports `inactive`) and
 * the site key reads as `null`, so no widget renders — the sign-up form
 * behaves exactly as it does without the provider.
 */
export const getTurnstileSiteKey = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string | null> => {
    const { readSiteKeyHandler } = await import('./turnstile.effects')
    return readSiteKeyHandler()
  }
)
