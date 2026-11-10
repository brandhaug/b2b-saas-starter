import { type Enrollment } from '@/components/auth/two-factor-flows'

/**
 * The two-factor panel's setup machine (ADR 0077 keeps UI machines hand-rolled
 * pure reducers): idle (with the last completion message) ↔ enrolling (the
 * one-time QR/secret reveal). The panel owns the query state; this module owns
 * only the step and its payload.
 */

export type SetupState =
  | { readonly step: 'idle'; readonly message: string | null }
  | { readonly step: 'enrolling'; readonly enrollment: Enrollment }

export type SetupEvent =
  | { readonly type: 'start' }
  | { readonly type: 'enrolled'; readonly enrollment: Enrollment }
  | { readonly type: 'completed'; readonly message: string }

/**
 * Applies one flow event. A repeat `start` never clobbers an in-progress
 * enrollment reveal; `enrolled` enters it from either step and `completed`
 * closes it, carrying the message back to idle.
 */
export function setupTransition(state: SetupState, event: SetupEvent): SetupState {
  switch (event.type) {
    case 'start': {
      return state.step === 'enrolling' ? state : { step: 'idle', message: null }
    }
    case 'enrolled': {
      return { step: 'enrolling', enrollment: event.enrollment }
    }
    case 'completed': {
      return { step: 'idle', message: event.message }
    }
  }
}
