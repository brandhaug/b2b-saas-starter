import { useState, type InputHTMLAttributes } from 'react'
import { useRouter } from '@tanstack/react-router'
import { formValue } from '@/lib/form-value.ts'
import { completeMerchantOnboarding } from '@/lib/server/merchant-onboarding.ts'

export function MerchantOnboardingForm() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  return (
    <main className="merchant-safe-area-page mx-auto grid min-h-dvh max-w-5xl items-center gap-10 p-6 lg:grid-cols-[0.9fr_1.1fr]">
      <section>
        <p className="text-xs font-medium text-foreground">Merchant Onboarding</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          Create your public booking identity
        </h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">
          These details establish your Merchant boundary, default Provider, and an
          Unpublished Public Booking Page. You can leave and safely return before
          completion; nothing partial is created.
        </p>
      </section>
      <form
        className="grid gap-5 border bg-card p-6"
        action={async (form) => {
          setPending(true)
          setMessage(null)
          try {
            await completeMerchantOnboarding({
              data: {
                publicName: formValue(form, 'publicName'),
                slug: formValue(form, 'slug'),
                timezone: formValue(form, 'timezone'),
                currency: formValue(form, 'currency')
              }
            })
            await router.invalidate()
          } catch (error: unknown) {
            const reason =
              typeof error === 'object' && error !== null && 'reason' in error
                ? String(error.reason)
                : ''
            setMessage(
              reason === 'slug_unavailable'
                ? 'That booking slug is already in use.'
                : reason === 'reserved_slug'
                  ? 'That slug is reserved by the Booking Product.'
                  : 'We could not complete onboarding. Check each value and try again.'
            )
          } finally {
            setPending(false)
          }
        }}
      >
        <Field
          label="Public name"
          name="publicName"
          placeholder="Ada Booking Studio"
          minLength={2}
          maxLength={80}
        />
        <Field
          label="Booking slug"
          name="slug"
          placeholder="ada-booking-studio"
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          minLength={3}
          maxLength={63}
        />
        <Field label="IANA timezone" name="timezone" placeholder="Europe/Bucharest" />
        <label className="grid gap-1.5 text-sm">
          Currency
          <select
            className="h-9 rounded-md border bg-card px-3"
            name="currency"
            defaultValue="EUR"
            required
          >
            <option value="EUR">EUR — Euro</option>
            <option value="RON">RON — Romanian leu</option>
            <option value="GBP">GBP — Pound sterling</option>
            <option value="USD">USD — US dollar</option>
          </select>
        </label>
        {message ? <p className="text-sm text-destructive">{message}</p> : null}
        <button
          className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
          disabled={pending}
          type="submit"
        >
          {pending ? 'Creating Merchant…' : 'Complete onboarding'}
        </button>
      </form>
    </main>
  )
}

function Field({
  label,
  ...input
}: { readonly label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="grid gap-1.5 text-sm">
      {label}
      <input className="h-9 rounded-md border bg-card px-3" required {...input} />
    </label>
  )
}
