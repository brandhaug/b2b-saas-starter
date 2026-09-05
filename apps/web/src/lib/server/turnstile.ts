import { createServerFn } from '@tanstack/react-start'

/**
 * Turnstile wiring for the web app (ADR 0031), in a **client-safe** module.
 *
 * This file is statically imported by the sign-in and sign-up routes, and the
 * route tree ships to the browser — so the verifier-layer factory and the
 * env-bag read live in `turnstile.effects.ts`, reached only through dynamic
 * `import()` inside the handler: TanStack Start strips handler bodies from
 * the client build, so the capabilities graph never ships. Both halves stay
 * env-gated: with the TURNSTILE variables unset the layer verifies nothing
 * (the capability reports `inactive`) and the site key reads as `null`, so no
 * widget renders — the sign-up form behaves exactly as it does without the
 * provider.
 */
export const getTurnstileSiteKey = createServerFn({ method: 'GET' }).handler(
  async (): Promise<string | null> => {
    const { readSiteKeyHandler } = await import('./turnstile.effects')
    return readSiteKeyHandler()
  }
)
