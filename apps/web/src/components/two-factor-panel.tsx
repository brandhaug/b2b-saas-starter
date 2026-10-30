import { useReducer, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { authClient } from '@/lib/auth-client'
import { unwrapAuthResult } from '@/lib/auth-result'
import { useClientValue } from '@/lib/client-only-value'
import { ShieldCheckIcon } from 'lucide-react'
import {
  EnabledFlows,
  EnableFlow,
  EnrollmentFlow,
  type Enrollment
} from '@/components/auth/two-factor-flows'
import { m } from '@b2b-saas-starter/i18n/messages'

type SetupState =
  | { readonly step: 'idle'; readonly message: string | null }
  | { readonly step: 'enrolling'; readonly enrollment: Enrollment }

type SetupEvent =
  | { readonly type: 'start' }
  | { readonly type: 'enrolled'; readonly enrollment: Enrollment }
  | { readonly type: 'completed'; readonly message: string }

function setupTransition(state: SetupState, event: SetupEvent): SetupState {
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

/**
 * Account-level two-factor management: enable (password → one-time QR/secret
 * reveal → first code), disable (password), regenerate backup codes
 * (password). TOTP only, matching the plugin's configuration in
 * `packages/auth`.
 *
 * Query owns the enabled flag. The reducer holds only the enrollment reveal
 * and completion message. Disable and regeneration share one mutation, while
 * each password form owns its own values.
 */
export function TwoFactorPanel({
  twoFactorEnabled,
  userId = 'current'
}: {
  // Optional/nullable to match the plugin's declared field shape; anything
  // truthy means "on".
  readonly twoFactorEnabled?: boolean | null | undefined
  readonly userId?: string
}) {
  const queryClient = useQueryClient()
  const hydrated = useClientValue(() => true, false)
  const queryKey = ['account', userId, 'two-factor']
  const { data: enabled } = useQuery({
    queryKey,
    queryFn: async () => {
      const session = await unwrapAuthResult(
        () => authClient.getSession(),
        m.two_factor_setup_failed()
      )
      return Boolean(session?.user.twoFactorEnabled)
    },
    initialData: Boolean(twoFactorEnabled),
    enabled: hydrated,
    staleTime: 60_000,
    retry: false
  })
  const [setup, dispatch] = useReducer(setupTransition, { step: 'idle', message: null })
  function clearStatus() {
    dispatch({ type: 'start' })
  }

  if (setup.step === 'enrolling') {
    return (
      <PanelFrame heading={m.setup_authenticator()} tone="enabled">
        <EnrollmentFlow
          enrollment={setup.enrollment}
          onStart={clearStatus}
          onVerified={async () => {
            await queryClient.cancelQueries({ queryKey, exact: true })
            queryClient.setQueryData(queryKey, true)
            dispatch({ type: 'completed', message: m.two_factor_now_on() })
          }}
        />
      </PanelFrame>
    )
  }

  if (enabled) {
    return (
      <PanelFrame heading={m.status()} tone="enabled">
        <p className="text-sm text-muted-foreground">
          {/* Status dot, from the status vocabulary: on = ok. */}
          <span
            className="mr-2 inline-block size-2 rounded-full bg-status-ok"
            aria-hidden="true"
          />
          {m.two_factor_on_description()}
        </p>
        <EnabledFlows
          onStart={clearStatus}
          onDisabled={async () => {
            await queryClient.cancelQueries({ queryKey, exact: true })
            queryClient.setQueryData(queryKey, false)
            dispatch({ type: 'completed', message: m.auth_two_factor_off() })
          }}
        />
        <StatusMessage message={setup.message} />
      </PanelFrame>
    )
  }

  return (
    <PanelFrame heading={m.turn_on()} tone="muted">
      <p className="text-sm text-muted-foreground">
        {/* Status dot: off = neutral outline, not a second gray. */}
        <span
          className="mr-2 inline-block size-2 rounded-full border border-border"
          aria-hidden="true"
        />
        {m.two_factor_off_description()}
      </p>
      <EnableFlow
        onStart={clearStatus}
        onEnrolled={(enrollment) => dispatch({ type: 'enrolled', enrollment })}
      />
      <StatusMessage message={setup.message} />
    </PanelFrame>
  )
}

/** The section, icon and heading every step of the panel renders inside. */
function PanelFrame({
  heading,
  tone,
  children
}: {
  readonly heading: string
  readonly tone: 'enabled' | 'muted'
  readonly children: ReactNode
}) {
  return (
    <section className="grid gap-4" aria-label={m.panel_two_factor()}>
      <header className="flex items-center gap-2">
        {/* `enabled` is an operational state, so it takes the status hue the
            rest of the app's "done" marks use; mauve stays for links and
            current/selected (DESIGN.md). */}
        <ShieldCheckIcon
          className={
            tone === 'enabled'
              ? 'size-4 text-status-ok'
              : 'size-4 text-muted-foreground'
          }
        />
        <h3 className="text-sm font-semibold">{heading}</h3>
      </header>
      {children}
    </section>
  )
}

/** The status line, in an `<output>` — role `status`, per the banner pattern. */
function StatusMessage({ message }: { readonly message: string | null }) {
  return message === null ? null : (
    <output className="block rounded-none border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      {message}
    </output>
  )
}
