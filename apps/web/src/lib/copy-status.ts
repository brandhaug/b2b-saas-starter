/**
 * The clipboard feedback machine behind `useClipboard` (ADR 0077 keeps UI
 * machines hand-rolled pure reducers). The hook owns the request fencing
 * (the symbol identity) and the expiry timers; this module owns only the four
 * status labels and which evidence may move them.
 */

export type CopyStatus = 'idle' | 'pending' | 'copied' | 'failed'

export type CopyStatusEvent =
  | { readonly type: 'requested' }
  | { readonly type: 'succeeded' }
  | { readonly type: 'failed' }
  | { readonly type: 'expired' }
  | { readonly type: 'replaced' }

/**
 * Applies one piece of copy evidence. A settle (`succeeded`/`failed`) only
 * lands on a pending copy and expiry only resets settled feedback, so stale
 * evidence cannot move a fresh request; `replaced` (the displayed value
 * changed) resets everything.
 */
export function copyStatusTransition(
  status: CopyStatus,
  event: CopyStatusEvent
): CopyStatus {
  switch (event.type) {
    case 'requested': {
      return 'pending'
    }
    case 'succeeded': {
      return status === 'pending' ? 'copied' : status
    }
    case 'failed': {
      return status === 'pending' ? 'failed' : status
    }
    case 'expired': {
      if (status === 'copied' || status === 'failed') {
        return 'idle'
      }
      return status
    }
    case 'replaced': {
      return 'idle'
    }
  }
}
