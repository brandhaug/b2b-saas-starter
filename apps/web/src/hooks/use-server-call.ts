import { m } from '@b2b-saas-starter/i18n/messages'
import { usePreview } from '@/lib/preview-context'
import { callServerFn } from '@/lib/server-call'

/** Shared call boundary for mutations and forms that own their submission state. */
export function useServerCall(): typeof callServerFn {
  const preview = usePreview()
  return (call, fallback, describe) => {
    if (preview) {
      // oxlint-disable-next-line effect/noNewPromise -- preserve the promise-shaped UI boundary without invoking the action
      return Promise.resolve({ ok: false, message: m.shell_demo_read_only() })
    }
    return callServerFn(call, fallback, describe)
  }
}
