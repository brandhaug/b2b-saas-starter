import { useEffect, useEffectEvent, useRef } from 'react'
import {
  DEFAULT_SCRIPT_ID,
  SCRIPT_URL,
  Turnstile,
  type TurnstileInstance
} from '@marsidev/react-turnstile'

// react-turnstile 1.6.3 leaves its shared readiness promise pending after script
// failure, with no public reset. Own only script loading so a later mount can
// retry; injectScript=false leaves widget rendering and cleanup to the library.
let scriptPromise: Promise<void> | undefined

function loadScript(): Promise<void> {
  if (scriptPromise) {
    return scriptPromise
  }
  // oxlint-disable-next-line effect/noNewPromise -- browser script load/error events are a DOM platform adapter
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(DEFAULT_SCRIPT_ID)
    if (existing && window.turnstile) {
      resolve()
      return
    }
    const script = existing ?? document.createElement('script')
    function failed() {
      scriptPromise = undefined
      script.remove()
      // oxlint-disable-next-line effect/noNewError -- DOM adapter failure, consumed by the widget effect
      reject(new Error('Failed to load the Turnstile script'))
    }
    script.addEventListener(
      'load',
      () => {
        if (window.turnstile) {
          resolve()
        } else {
          failed()
        }
      },
      { once: true }
    )
    script.addEventListener('error', failed, { once: true })
    if (!existing && script instanceof HTMLScriptElement) {
      script.id = DEFAULT_SCRIPT_ID
      script.src = `${SCRIPT_URL}?render=explicit`
      script.async = true
      // oxlint-disable-next-line unicorn/prefer-dom-node-append -- bun-types shadows DOM append with a non-node signature
      document.head.appendChild(script)
    }
  })
  return scriptPromise
}

/** Mounted only when configured. Forms bump resetKey after consuming a token. */
export function TurnstileWidget({
  siteKey,
  onToken,
  resetKey = 0
}: {
  readonly siteKey: string
  readonly onToken: (token: string | null) => void
  readonly resetKey?: number
}) {
  const widget = useRef<TurnstileInstance>(undefined)
  const onScriptError = useEffectEvent(() => onToken(null))

  useEffect(() => {
    let cancelled = false
    void loadScript().catch(() => {
      if (!cancelled) {
        onScriptError()
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (resetKey !== 0) {
      widget.current?.reset()
    }
  }, [resetKey])

  return (
    <div className="flex justify-center">
      <Turnstile
        ref={widget}
        injectScript={false}
        siteKey={siteKey}
        onSuccess={onToken}
        onExpire={() => onToken(null)}
        onError={() => onToken(null)}
      />
    </div>
  )
}
