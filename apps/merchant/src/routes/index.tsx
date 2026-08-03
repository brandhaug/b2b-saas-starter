import { createFileRoute, redirect } from '@tanstack/react-router'
import { MerchantOnboardingForm } from '@/features/onboarding/merchant-onboarding-form.tsx'
import { VerificationRequired } from '@/features/onboarding/verification-required.tsx'
import { dateInTimezone } from '@/lib/appointment-format.ts'
import { getMerchantOnboardingStatus } from '@/lib/server/merchant-onboarding.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/')({
  beforeLoad: async ({ location }) => {
    await requireMerchantSession(location.href)
  },
  loader: async () => {
    const status = await getMerchantOnboardingStatus()
    if (status.state === 'merchant')
      throw redirect({
        to: '/appointments',
        search: { date: dateInTimezone(new Date(), status.merchant.timezone) }
      })
    return status
  },
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
  return null
}
