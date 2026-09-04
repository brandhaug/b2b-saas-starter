import { type ReactNode } from 'react'
import { useClientValue } from '@/lib/client-only-value'
import { safeRedirect } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  readLastLoginMethodWithAuthClient,
  signInSocialWithAuthClient,
  type ReadLastLoginMethod,
  type SignInWithSocial,
  type SocialProviderId
} from '@/components/auth/auth-client-ports'
import {
  SOCIAL_PROVIDER_LABELS,
  loginMethodLabel
} from '@/components/auth/social-provider-labels'

/**
 * The provider marks, as inline SVG at the same 16px the other auth buttons
 * use for their icons. Brand marks are not in lucide, and the DESIGN.md
 * "no clipping ornaments" rule is about button shapes — a monochrome mark
 * with `currentColor` keeps the buttons on the token system.
 */
function GithubMarkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 shrink-0">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.07-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A7.995 7.995 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  )
}

function GoogleMarkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 shrink-0">
      <path
        fill="currentColor"
        d="M8.05 1.93c1.67 0 3.16.58 4.34 1.71l-1.83 1.42a3.75 3.75 0 0 0-2.51-.9 4.03 4.03 0 0 0-3.8 2.78l-2.1-1.62A6.06 6.06 0 0 1 8.05 1.93Zm5.9 3.14a6.1 6.1 0 0 1 .08 6.79c-.78 1.2-2.02 2.1-3.54 2.43a6.2 6.2 0 0 1-4.5-.75 5.9 5.9 0 0 1-2.26-2.6l2.1-1.62a3.88 3.88 0 0 0 4.06 2.85 3.1 3.1 0 0 0 1.94-1.1 2.9 2.9 0 0 0 .42-.73H8.06V7.35h5.66c.12.56.2 1.14.23 1.72Z"
      />
    </svg>
  )
}

const PROVIDER_ICONS = {
  github: GithubMarkIcon,
  google: GoogleMarkIcon
} satisfies Record<SocialProviderId, () => ReactNode>

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
  redirectTo,
  signIn = signInSocialWithAuthClient
}: {
  readonly providers: ReadonlyArray<SocialProviderId>
  readonly redirectTo?: string | undefined
  readonly signIn?: SignInWithSocial
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
                void signIn({
                  provider,
                  callbackURL: `${window.location.origin}${safeRedirect(redirectTo)}`
                })
              }}
            >
              <Icon />
              Continue with {SOCIAL_PROVIDER_LABELS[provider]}
            </Button>
          )
        })}
      </div>
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or continue with email</span>
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
export function LastSignInMethodHint({
  readLastLoginMethod = readLastLoginMethodWithAuthClient
}: {
  readonly readLastLoginMethod?: ReadLastLoginMethod
}) {
  const method = useClientValue(readLastLoginMethod, null)
  if (method === null) {
    return null
  }
  return (
    <p className="text-xs text-muted-foreground">
      Last signed in with {loginMethodLabel(method)}.
    </p>
  )
}
