import { useEffect, useRef, useState } from 'react'
import { copyStatusTransition, type CopyStatus } from '@/lib/copy-status'

/** Local clipboard feedback, scoped to the displayed value rather than a server action. */
export function useClipboard(
  value: string,
  {
    successDuration,
    failureDuration
  }: { readonly successDuration?: number; readonly failureDuration?: number } = {}
) {
  const [state, setState] = useState<{ value: string; status: CopyStatus }>({
    value,
    status: 'idle'
  })
  const request = useRef<symbol | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mountedValue = useRef<string | null>(null)

  // Reset before children render, without remounting the live region or focused button.
  if (state.value !== value) {
    setState({
      value,
      status: copyStatusTransition(state.status, { type: 'replaced' })
    })
  }

  useEffect(() => {
    mountedValue.current = value
    return () => {
      mountedValue.current = null
      request.current = null
      clearTimeout(timer.current)
      timer.current = undefined
    }
  }, [value])

  async function copy(text = value) {
    if (mountedValue.current !== value || request.current !== null) {
      return
    }
    const identity = Symbol()
    request.current = identity
    clearTimeout(timer.current)
    timer.current = undefined
    setState({
      value,
      status: copyStatusTransition(state.status, { type: 'requested' })
    })
    let succeeded = true
    // oxlint-disable-next-line effect/noTryCatch -- Clipboard is a browser platform boundary; retain local manual-selection recovery.
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      succeeded = false
    }
    if (request.current !== identity) {
      return
    }
    request.current = null
    const status = copyStatusTransition(
      'pending',
      succeeded ? { type: 'succeeded' } : { type: 'failed' }
    )
    setState({ value, status })
    const duration = status === 'copied' ? successDuration : failureDuration
    if (duration !== undefined) {
      timer.current = setTimeout(() => {
        timer.current = undefined
        setState({ value, status: copyStatusTransition(status, { type: 'expired' }) })
      }, duration)
    }
  }

  return { status: state.value === value ? state.status : 'idle', copy }
}
