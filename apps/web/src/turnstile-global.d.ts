// Global augmentation for the Turnstile Web script
// (https://challenges.cloudflare.com/turnstile/v0/api.js), loaded on demand by
// TurnstileWidget. This .d.ts stays a script (no imports/exports), so this
// interface merges with lib.dom's `Window` directly — same pattern as
// worker-env.d.ts.
interface Window {
  turnstile?: {
    render: (
      container: HTMLElement,
      params: {
        sitekey: string
        callback: (token: string) => void
        'expired-callback'?: () => void
        theme?: 'light' | 'dark' | 'auto'
      }
    ) => string
    remove: (widgetId: string) => void
    reset: (widgetId?: string) => void
  }
}
