import { createFileRoute, Link } from '@tanstack/react-router'
import { Schema } from 'effect'
import { CheckCircle2Icon, CircleAlertIcon } from 'lucide-react'
import { PublicLayout } from '@/components/public-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const VerifyEmailSearch = Schema.Struct({
  error: Schema.optional(Schema.String)
})

const decodeSearch = Schema.decodeUnknownSync(VerifyEmailSearch)

export const Route = createFileRoute('/verify-email')({
  validateSearch: (search) => decodeSearch(search),
  component: VerifyEmailRoute
})

/**
 * The landing page for the verification link. The emailed URL points at the
 * auth handler, which verifies the token and redirects here — success arrives
 * with no params (and a session cookie, via autoSignInAfterVerification),
 * failure with `?error=<code>`. This page only reports what already happened.
 */
function VerifyEmailRoute() {
  const { error } = Route.useSearch()
  return <VerifyEmailPage error={error} />
}

export function VerifyEmailPage({ error }: { readonly error?: string | undefined }) {
  return (
    <PublicLayout>
      <main
        id="main-content"
        className="mx-auto grid w-full max-w-md flex-1 place-items-center px-4 py-12"
      >
        <Card className="w-full">
          <CardHeader>
            <CardTitle as="h1">
              {error ? (
                <span className="flex items-center gap-2">
                  <CircleAlertIcon className="size-5 text-destructive" />
                  Verification failed
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <CheckCircle2Icon className="size-5 text-primary" />
                  Email verified
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {error ? (
              <>
                <p className="text-sm text-muted-foreground">
                  This verification link is invalid or has expired. Links work once and
                  expire after an hour.
                </p>
                <p className="text-sm text-muted-foreground">
                  Still signed in? The banner on your workspaces page can send a fresh
                  link.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Your email address is verified. You are signed in and ready to go.
              </p>
            )}
            <p className="text-center text-sm text-muted-foreground">
              <Link
                to="/workspaces"
                className="text-primary underline underline-offset-4"
              >
                Go to your workspaces
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    </PublicLayout>
  )
}
