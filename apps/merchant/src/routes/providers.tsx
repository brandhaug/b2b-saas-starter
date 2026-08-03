import { useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { MerchantShell } from '@/components/merchant-shell/index.ts'
import { mobileSheetNavigationState } from '@/components/merchant-shell/mobile/mobile-sheet-gesture.ts'
import { formValue } from '@/lib/form-value.ts'
import {
  getMerchantCatalog,
  saveMerchantProvider
} from '@/lib/server/merchant-catalog.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/providers')({
  beforeLoad: async ({ location }) => requireMerchantSession(location.href),
  loader: () => getMerchantCatalog(),
  component: OwnerProviderPage
})

function OwnerProviderPage() {
  const catalog = Route.useLoaderData()
  const provider = catalog.providers.find((item) => item.isDefault) ?? null
  const router = useRouter()
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const saveProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!provider) return
    const form = new FormData(event.currentTarget)
    setPending(true)
    setMessage(null)
    void saveMerchantProvider({
      data: {
        id: provider.id,
        displayName: formValue(form, 'displayName')
      }
    })
      .then(() => {
        setMessage('Professional profile saved.')
        void router.invalidate()
      })
      .catch(() => setMessage('Check the professional name and try again.'))
      .finally(() => setPending(false))
  }

  return (
    <MerchantShell
      section={{ kind: 'catalog' }}
      title="Professional profile"
      description="This is the sole active professional customers book with."
    >
      {provider ? (
        <div className="mt-2 grid gap-4 rounded-2xl border bg-muted/20 p-4 md:mt-8 md:rounded-md md:p-5">
          <form className="grid gap-4" onSubmit={saveProfile}>
            <label className="grid gap-1.5 text-sm">
              Customer-facing name
              <input
                name="displayName"
                defaultValue={provider.displayName}
                minLength={2}
                maxLength={80}
                required
                className="h-10 rounded-xl border bg-card px-3 md:h-9 md:rounded-md"
              />
            </label>
            <button
              type="submit"
              disabled={pending}
              className="h-10 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground md:h-9 md:rounded-md"
            >
              {pending ? 'Saving…' : 'Save profile'}
            </button>
          </form>
          <Link
            to="/availability"
            replace
            viewTransition={false}
            state={mobileSheetNavigationState}
            className="inline-flex h-10 items-center justify-center rounded-xl border bg-card px-4 text-sm font-medium md:h-9 md:rounded-md"
          >
            Configure availability
          </Link>
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          The Owner-Provider profile is unavailable. Contact BeeSolo support.
        </p>
      )}
    </MerchantShell>
  )
}
