import { type ComponentType, type SVGProps } from 'react'
import { Activity, BarChart3, CreditCard, Mail, ShieldCheck } from 'lucide-react'
import { DEPLOY_COMMAND } from '@/lib/toolchain'
import { m } from '@b2b-saas-starter/i18n/messages'

/** `to` stays a literal union so TanStack Router still type-checks the links.
 *  No Pricing entry: the starter is MIT and does not sell plans — the plan
 *  vocabulary lives in the capability catalog and the billing docs. */
export type PublicLink = {
  readonly to: '/' | '/docs' | '/help'
  readonly hash?: string
  readonly label: string
}

export function publicLinkProps(
  link: PublicLink
):
  | { readonly to: '/' | '/docs' | '/help' }
  | { readonly to: '/'; readonly hash: string } {
  if (link.hash === undefined) {
    return { to: link.to }
  }
  return { to: link.to, hash: link.hash }
}

export function publicLinks(): ReadonlyArray<PublicLink> {
  return [
    { to: '/docs', label: m.docs() },
    { to: '/', hash: 'faq', label: m.faq() },
    { to: '/help', label: m.public_meta_support() }
  ]
}

type OptionalProviderModule = {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly icon: ComponentType<SVGProps<SVGSVGElement>>
}

export function optionalProviderModules(): ReadonlyArray<OptionalProviderModule> {
  return [
    {
      id: 'stripe',
      name: 'Stripe',
      role: m.provider_stripe(),
      icon: CreditCard
    },
    {
      id: 'sentry',
      name: 'Sentry',
      role: m.provider_sentry(),
      icon: Activity
    },
    {
      id: 'posthog',
      name: 'PostHog',
      role: m.provider_posthog(),
      icon: BarChart3
    },
    {
      id: 'cloudflare-email',
      name: 'Cloudflare Email',
      role: m.provider_email(),
      icon: Mail
    },
    {
      id: 'turnstile',
      name: 'Turnstile',
      role: m.provider_turnstile(),
      icon: ShieldCheck
    }
  ]
}

export type FaqItem = { readonly question: string; readonly answer: string }

export function faqItems(): ReadonlyArray<FaqItem> {
  return [
    {
      question: m.public_faq_q1(),
      answer: m.public_faq_a1()
    },
    {
      question: m.public_faq_q2(),
      answer: m.public_faq_a2()
    },
    {
      question: m.public_faq_q3(),
      answer: m.public_faq_a3()
    },
    {
      question: m.public_faq_q4(),
      answer: m.public_faq_a4()
    },
    {
      question: m.public_faq_q5(),
      answer: m.public_faq_a5({ command: DEPLOY_COMMAND })
    },
    {
      question: m.public_faq_q6(),
      answer: m.public_faq_a6()
    },
    {
      question: m.public_faq_q7(),
      answer: m.public_faq_a7()
    }
  ]
}
