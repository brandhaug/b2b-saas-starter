// Ambient types for Cloudflare Turnstile's explicit-render script
// (https://challenges.cloudflare.com/turnstile/v0/api.js). Declaration merges
// live in `.d.ts` files per the repo's lint rules, and this file stays a plain
// global script (no top-level imports or exports) so its interface merges —
// including `Window` — apply globally.

interface TurnstileRenderParameters {
  sitekey: string
  callback: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: () => void
  theme?: 'light' | 'dark' | 'auto'
}

interface TurnstileApi {
  render: (element: HTMLElement, params: TurnstileRenderParameters) => string
  remove: (widgetId: string) => void
  reset: (widgetId?: string) => void
}

interface Window {
  turnstile?: TurnstileApi
}
