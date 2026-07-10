import { useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import type { MerchantRecord } from '@b2b-saas-starter/capabilities'
import { merchantAuthClient } from '@/lib/auth-client.ts'
import { formValue } from '@/lib/form-value.ts'
import {
  completeMerchantOnboarding,
  getMerchantOnboardingStatus
} from '@/lib/server/merchant-onboarding.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/')({
  beforeLoad: async ({ location }) => {
    await requireMerchantSession(location.href)
  },
  loader: () => getMerchantOnboardingStatus(),
  component: IndexPage
})

function IndexPage() {
  const status = Route.useLoaderData()

  if (status.state === 'verification-required') {
    return <VerificationRequired />
  }
  if (status.state === 'onboarding') {
    return <MerchantOnboardingForm />
  }
  return <MerchantHome merchant={status.merchant} />
}

function VerificationRequired() {
  const router = useRouter()
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <section className="w-full max-w-lg border bg-card p-6">
        <p className="text-xs font-medium text-primary">Email verification required</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Verify before creating a Merchant
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Until your email is verified, this account can only verify or recover access,
          resend verification, or sign out.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground"
            to="/verify-email"
          >
            Verify or resend
          </Link>
          <Link
            className="inline-flex h-9 items-center rounded-md bg-secondary px-3 text-sm text-secondary-foreground"
            to="/forgot-password"
          >
            Recover access
          </Link>
          <button
            className="h-9 rounded-md px-3 text-sm"
            type="button"
            onClick={() => {
              void merchantAuthClient
                .signOut()
                .then(() => router.history.push('/sign-in'))
            }}
          >
            Sign out
          </button>
        </div>
      </section>
    </main>
  )
}

function MerchantOnboardingForm() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  return (
    <main className="mx-auto grid min-h-dvh max-w-5xl items-center gap-10 p-6 lg:grid-cols-[0.9fr_1.1fr]">
      <section>
        <p className="text-xs font-medium text-primary">Merchant Onboarding</p>
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
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          setPending(true)
          setMessage(null)
          void completeMerchantOnboarding({
            data: {
              publicName: formValue(form, 'publicName'),
              slug: formValue(form, 'slug'),
              timezone: formValue(form, 'timezone'),
              currency: formValue(form, 'currency')
            }
          })
            .then(() => router.invalidate())
            .catch((error: unknown) => {
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
            })
            .finally(() => setPending(false))
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

type MerchantHomeProps = {
  readonly merchant: MerchantRecord
}

function MerchantHome({ merchant }: MerchantHomeProps) {
  const router = useRouter()
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <section className="w-full max-w-2xl border bg-card p-6">
        <p className="text-xs font-medium text-primary">Merchant App</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {merchant.publicName}
        </h1>
        <dl className="mt-6 grid gap-4 border-y py-5 text-sm sm:grid-cols-2">
          <Summary
            label="Public Booking Page"
            value={merchant.publicBookingPage.status}
          />
          <Summary label="Booking slug" value={merchant.slug} />
          <Summary label="Timezone" value={merchant.timezone} />
          <Summary label="Currency" value={merchant.currency} />
          <Summary
            label="Default Provider"
            value={merchant.defaultProvider.displayName}
          />
        </dl>
        <Link
          to="/prototype/minimum-merchant-surface"
          search={{ variant: 'A', screen: 'launch' }}
          className="mt-6 inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
        >
          Continue Merchant setup
        </Link>
        <button
          className="ml-4 mt-6 h-9 rounded-md px-3 text-sm text-primary underline underline-offset-4"
          type="button"
          onClick={() =>
            void merchantAuthClient
              .signOut()
              .then(() => router.history.push('/sign-in'))
          }
        >
          Sign out
        </button>
      </section>
    </main>
  )
}

function Summary({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium capitalize">{value}</dd>
    </div>
  )
}
