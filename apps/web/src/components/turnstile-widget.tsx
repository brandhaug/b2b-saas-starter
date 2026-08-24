import { useEffect, useRef, useState } from 'react'

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
const SCRIPT_ID = 'cf-turnstile-script'

/**
 * Cloudflare Turnstile challenge widget (ADR 0031). The caller decides
 * whether to render it at all — the page only mounts it when a site key is
 * configured, so an unset `TURNSTILE_SITE_KEY` leaves forms untouched.
 *
 * Reports each solved token through `onToken`; expiry clears it. A widget
 * that never solves simply never reports, and the server gate fails closed —
 * this component is presentation, not enforcement.
 */
export function TurnstileWidget({
  siteKey,
  onToken
}: {
  readonly siteKey: string
  readonly onToken: (token: string | null) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Latest-callback ref: the mount effect depends only on `siteKey`, so a
  // parent re-render never tears down a half-solved challenge.
  const onTokenRef = useRef(onToken)
  useEffect(() => {
    onTokenRef.current = onToken
  })
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let widgetId: string | undefined
    let cancelled = false

    function mount() {
      if (cancelled || !containerRef.current || !window.turnstile) return
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token) => {
          onTokenRef.current(token)
        },
        'expired-callback': () => {
          onTokenRef.current(null)
        },
        theme: 'auto'
      })
    }
    function onLoadFail() {
      if (!cancelled) setFailed(true)
    }

    const existing = document.getElementById(SCRIPT_ID)
    const script =
      existing instanceof HTMLScriptElement
        ? existing
        : document.createElement('script')
    if (!(existing instanceof HTMLScriptElement)) {
      script.id = SCRIPT_ID
      script.src = SCRIPT_SRC
      script.async = true
      script.defer = true
      // `document.head.append` resolves to a workers-types body mixin here,
      // so the classic DOM API it is.
      // oxlint-disable-next-line unicorn/prefer-dom-node-append
      document.head.appendChild(script)
    }
    script.addEventListener('load', mount, { once: true })
    script.addEventListener('error', onLoadFail, { once: true })
    if (window.turnstile) mount()

    return () => {
      cancelled = true
      script.removeEventListener('load', mount)
      script.removeEventListener('error', onLoadFail)
      if (widgetId !== undefined && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [siteKey])

  if (failed) return null

  return (
    <div
      ref={containerRef}
      data-testid="turnstile-widget"
      aria-label="Human verification"
    />
  )
}
