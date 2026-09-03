import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { CircleAlertIcon } from 'lucide-react'
import { PublicLayout } from '@/components/public-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { pickOptionalStrings } from '@/lib/utils'

export const Route = createFileRoute('/magic-link/verify')({
  validateSearch: (search) => pickOptionalStrings(search, ['error']),
  // The emailed link points at the auth handler's token-exchange hop
  // (`GET /api/auth/magic-link/verify?token=…&callbackURL=…`), which consumes
  // the single-use token and redirects here — success with no params (and a
  // session cookie), failure with `?error=<code>`. Success therefore has
  // nothing left to show: the hop already signed the visitor in, so the
  // arrival continues straight to the workspaces index. Only the failure
  // states render this page.
  beforeLoad: ({ search }) => {
    if (search.error === undefined) {
      throw redirect({ to: '/workspaces' })
    }
  },
  component: MagicLinkVerifyRoute,
  head: () => ({ meta: [{ title: 'Sign-in link | B2B SaaS Starter' }] })
})

function MagicLinkVerifyRoute() {
  return <MagicLinkVerifyPage />
}

/**
 * The failure landing for the magic link: the token was invalid, expired, or
 * already used. The hop answers every one of those the same way, so the page
 * does too, and offers the way back to a fresh link rather than a dead end.
 * It takes no props because it reads nothing: `beforeLoad` above guarantees
 * an `error` param is present by the time this renders, and the page reports
 * one opaque state for every code.
 */
export function MagicLinkVerifyPage() {
  return (
    <PublicLayout>
      <main
        id="main-content"
        className="mx-auto grid w-full max-w-md flex-1 place-items-center px-4 py-12"
      >
        <Card className="w-full">
          <CardHeader>
            <CardTitle as="h1">
              <span className="flex items-center gap-2">
                <CircleAlertIcon className="size-5 text-destructive" />
                This sign-in link cannot be used
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              The link is invalid, has expired, or was already used. Each one works once
              and expires ten minutes after it is sent.
            </p>
            <p className="text-sm text-muted-foreground">
              Still have the email? A newer link replaces an older one. You can also
              sign in with your password.
            </p>
            <p className="text-center text-sm text-muted-foreground">
              <Link
                to="/sign-in"
                search={{}}
                className="text-primary underline underline-offset-4"
              >
                Request a new link or use your password
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    </PublicLayout>
  )
}
