import { type ReactNode, type SVGProps } from 'react'
import { useClientValue } from '@/lib/client-only-value'
import { safeRedirect } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { GithubIcon } from '@/components/icons/github'
import { GoogleIcon } from '@/components/icons/google'
import { authClient } from '@/lib/auth-client'
import { type SocialProviderId } from '@/components/auth/auth-client-ports'
import {
  SOCIAL_PROVIDER_LABELS,
  loginMethodLabel
} from '@/components/auth/social-provider-labels'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * The provider marks, at the same 16px the other auth buttons use for their
 * icons. Both live in `components/icons` so the mark on this button and the
 * one in the landing hero are the same drawing at the same viewBox.
 */
const PROVIDER_ICONS = {
  github: GithubIcon,
  google: GoogleIcon
} satisfies Record<SocialProviderId, (props: SVGProps<SVGSVGElement>) => ReactNode>

/**
 * One button per active provider, followed by the divider that seams the
 * buttons to the email form below — the two are one unit, so the divider is
 * never rendered without buttons. Renders nothing when the list is empty:
 * the provider-light default leaves the auth screens what they were before
 * social sign-in existed.
 *
 * Secondary buttons by DESIGN.md: `button-primary` is one per screen region
 * and the email form's submit already owns it here.
 */
export function SocialSignInButtons({
  providers,
  redirectTo
}: {
  readonly providers: ReadonlyArray<SocialProviderId>
  readonly redirectTo?: string | undefined
}) {
  if (providers.length === 0) {
    return null
  }
  return (
    <>
      <div className="grid gap-2">
        {providers.map((provider) => {
          const Icon = PROVIDER_ICONS[provider]
          return (
            <Button
              key={provider}
              type="button"
              variant="secondary"
              onClick={() => {
                // Better Auth's client navigates to the authorize URL itself
                // when the endpoint answers `{ url, redirect: true }`.
                void authClient.signIn.social({
                  provider,
                  errorCallbackURL: `${window.location.origin}/sign-in?redirect=${encodeURIComponent(safeRedirect(redirectTo))}`,
                  callbackURL: `${window.location.origin}${safeRedirect(redirectTo)}`
                })
              }}
            >
              <Icon className="size-4 shrink-0" />
              {m.public_auth_continue_with_provider({
                provider: SOCIAL_PROVIDER_LABELS[provider]
              })}
            </Button>
          )
        })}
      </div>
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">
          {m.or_continue_with_email()}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
    </>
  )
}

/**
 * "Last signed in with GitHub", from the `lastLoginMethod` plugin's
 * client-readable cookie. Rendered only after hydration (a cookie read on the
 * server would render a different string than the client paints) and only
 * when a method is remembered; the quiet aside styling keeps it a hint, not
 * an alert.
 */
export function LastSignInMethodHint() {
  const method = useClientValue(() => authClient.getLastUsedLoginMethod(), null)
  if (method === null) {
    return null
  }
  return (
    <p className="text-xs text-muted-foreground">
      {m.public_auth_last_signed_in_with({ method: loginMethodLabel(method) })}
    </p>
  )
}
