import { useEffect, useRef, type ReactNode } from 'react'
import { useHydrated } from '@/lib/client-only-value'
import { PublicLayout } from '@/components/public-layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * The only part of the form API the shell reads. Structural so it accepts any
 * `useForm` result regardless of its value/validator generics.
 */
export type SubscribableForm = {
  readonly handleSubmit: () => void | Promise<void>
}

/**
 * The card + form shell every auth screen renders: PublicLayout → centered
 * Card → one `<form>` wrapping the fields, the submit control and — last, so
 * it sits at the point of action — the error alert.
 *
 * The e2e hydration signal is set here by construction: every auth form gets
 * `data-hydrated` once React hydrates, with no per-route copy to forget.
 *
 * `form` may be `null` for a card that carries no form (e.g. the sent
 * confirmation on forgot-password); the children then render without a
 * `<form>` wrapper.
 */
export function AuthCardForm({
  title,
  description,
  form,
  submit,
  error,
  notice,
  footer,
  children
}: {
  readonly title: string
  readonly description?: ReactNode
  /** `null` renders the children without a `<form>` wrapper. */
  readonly form: SubscribableForm | null
  /** The submit control — an `<AuthSubmitButton>` in practice. */
  readonly submit?: ReactNode
  /** Submit failure message; rendered as a destructive alert inside the form. */
  readonly error?: string | null
  /** Guidance rather than failure (e.g. a require-SSO domain refusing the password path). */
  readonly notice?: string | null
  /** Rendered in the card body after the form (links, hints). */
  readonly footer?: ReactNode
  readonly children: ReactNode
}) {
  // Hydration signal for e2e: interacting before React hydrates falls through
  // to a native GET submit, so the smoke test waits for this attribute.
  const hydrated = useHydrated()
  const errorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (error) {
      errorRef.current?.focus()
    }
  }, [error])
  return (
    <PublicLayout>
      {/* `flex-1` fills the space PublicLayout's `min-h-dvh flex-col` leaves
          between the header and its `mt-auto` footer — no hardcoded chrome height. */}
      <main
        id="main-content"
        className="mx-auto grid w-full max-w-md flex-1 place-items-center px-4 py-12"
      >
        <Card className="w-full">
          <CardHeader>
            <CardTitle as="h1">{title}</CardTitle>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-4">
            {form === null ? (
              <div className="grid gap-4">{children}</div>
            ) : (
              <form
                data-hydrated={hydrated ? 'true' : undefined}
                onSubmit={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void form.handleSubmit()
                }}
                className="grid gap-4"
              >
                {children}
                {submit}
                {error ? (
                  <Alert ref={errorRef} tabIndex={-1} variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                {notice ? (
                  <Alert>
                    <AlertDescription>{notice}</AlertDescription>
                  </Alert>
                ) : null}
              </form>
            )}
            {footer}
          </CardContent>
        </Card>
      </main>
    </PublicLayout>
  )
}
