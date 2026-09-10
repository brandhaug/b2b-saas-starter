import { useEffect, useRef } from 'react'

// oxlint-disable effect/noNewPromise -- a browser script tag has no Effect wrapper; this module is DOM platform code, not application logic

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
const SCRIPT_ID = 'cf-turnstile-script'

// One shared loader: the script tag is appended once per page, every mounted
// widget waits on the same promise.
let scriptPromise: Promise<TurnstileApi> | undefined

function loadTurnstileScript(): Promise<TurnstileApi> {
  if (scriptPromise !== undefined) {
    return scriptPromise
  }
  scriptPromise = new Promise((resolve, reject) => {
    function settle() {
      if (window.turnstile === undefined) {
        // Allow a later mount to retry: the failed promise is not cached.
        scriptPromise = undefined
        // oxlint-disable-next-line effect/noNewError -- browser-platform failure signal; there is no Effect context here to lift into
        reject(new Error('Turnstile loaded without its API'))
        return
      }
      resolve(window.turnstile)
    }
    const existing = document.getElementById(SCRIPT_ID)
    if (existing !== null) {
      // `{ once: true }`: the listener must not outlive this loader — and an
      // already-loaded tag never fires `load` again, so resolve immediately.
      if (window.turnstile !== undefined) {
        resolve(window.turnstile)
        return
      }
      existing.addEventListener('load', settle, { once: true })
      return
    }
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = SCRIPT_SRC
    script.async = true
    script.addEventListener('load', settle, { once: true })
    script.addEventListener(
      'error',
      () => {
        // Allow a later mount to retry.
        scriptPromise = undefined
        // oxlint-disable-next-line effect/noNewError -- browser-platform failure signal; there is no Effect context here to lift into
        reject(new Error('Failed to load the Turnstile script'))
      },
      { once: true }
    )
    // bun-types' `append` only models string children; the DOM method takes nodes.
    // oxlint-disable-next-line unicorn/prefer-dom-node-append -- see above; the type conflict is bun-types vs DOM lib, not style
    document.head.appendChild(script)
  })
  return scriptPromise
}

/**
 * The Turnstile challenge widget, explicit-render flavor. Renders nothing —
 * and loads no script — until a site key is passed, which is the whole
 * provider-light story: a form only mounts this when the server reports
 * `TURNSTILE_SITE_KEY` is configured.
 *
 * `resetKey` is how a form asks for a fresh challenge: a Turnstile token is
 * single-use, so a screen that sends twice (the code resend, the reset page's
 * second ask) bumps the counter after each send and the widget issues a new
 * token through `onToken`.
 */
export function TurnstileWidget({
  siteKey,
  onToken,
  resetKey = 0
}: {
  readonly siteKey: string
  readonly onToken: (token: string | null) => void
  readonly resetKey?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onTokenRef = useRef(onToken)
  const widgetIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    onTokenRef.current = onToken
  }, [onToken])

  useEffect(() => {
    let cancelled = false

    function mount(api: TurnstileApi) {
      if (cancelled || containerRef.current === null) {
        return
      }
      widgetIdRef.current = api.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token) => onTokenRef.current(token),
        'expired-callback': () => onTokenRef.current(null),
        'error-callback': () => onTokenRef.current(null)
      })
    }

    loadTurnstileScript()
      .then(mount)
      .catch(() => {
        // A failed script load must not wedge the form silently forever; the
        // submit-side token requirement surfaces the state to the visitor.
        onTokenRef.current(null)
      })

    return () => {
      cancelled = true
      const widgetId = widgetIdRef.current
      widgetIdRef.current = undefined
      if (widgetId !== undefined && window.turnstile !== undefined) {
        window.turnstile.remove(widgetId)
      }
    }
  }, [siteKey])

  useEffect(() => {
    // Skips the first render: the mount above already issued the first token.
    if (resetKey === 0) {
      return
    }
    const widgetId = widgetIdRef.current
    if (widgetId !== undefined && window.turnstile !== undefined) {
      window.turnstile.reset(widgetId)
    }
  }, [resetKey])

  return <div ref={containerRef} className="flex justify-center" />
}
