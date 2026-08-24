import { type ComponentType, type SVGProps } from 'react'
import { Activity, BarChart3, CreditCard, Mail, ShieldCheck } from 'lucide-react'

/** `to` stays a literal union so TanStack Router still type-checks the links. */
type PublicLink = {
  readonly to: '/docs' | '/blog' | '/pricing' | '/faq'
  readonly label: string
}

export const publicLinks: readonly PublicLink[] = [
  { to: '/docs', label: 'Docs' },
  { to: '/blog', label: 'Blog' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/faq', label: 'FAQ' }
]

type OptionalProviderModule = {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly icon: ComponentType<SVGProps<SVGSVGElement>>
}

export const optionalProviderModules: readonly OptionalProviderModule[] = [
  {
    id: 'stripe',
    name: 'Stripe',
    role: 'Billing checkout, portal, and webhooks',
    icon: CreditCard
  },
  {
    id: 'sentry',
    name: 'Sentry',
    role: 'Error monitoring across all three Workers',
    icon: Activity
  },
  {
    id: 'posthog',
    name: 'PostHog',
    role: 'Product analytics — browser and all three Workers',
    icon: BarChart3
  },
  {
    id: 'cloudflare-email',
    name: 'Cloudflare Email',
    role: 'Outbound transactional email',
    icon: Mail
  },
  {
    id: 'turnstile',
    name: 'Turnstile',
    role: 'Bot protection on public forms',
    icon: ShieldCheck
  }
]

type FaqItem = { readonly question: string; readonly answer: string }

export const faqItems: readonly FaqItem[] = [
  {
    question: 'Why TanStack Start instead of Next.js or Remix?',
    answer:
      'TanStack Start runs natively on a Cloudflare Worker without a Node adapter, ships file-based routing with strongly typed loaders, and stays close to the underlying Web Fetch API. It composes cleanly with Effect v4 server functions and avoids the dual Edge/Node runtime split.'
  },
  {
    question: 'Why Effect v4 for the application backbone?',
    answer:
      'Effect gives us typed errors, dependency injection, and HTTP API contracts shared between the API Worker, MCP discovery, and the web app. Capabilities are written once and reused across REST, MCP, server functions, and background jobs — no duplicated business logic.'
  },
  {
    question: 'How do I add a new capability?',
    answer:
      'Add the capability in packages/capabilities, wire its Seed/Live layers, surface it on a workspace route, and (optionally) expose it through REST and MCP. The Seed/Live contract keeps tests and production on one interface.'
  },
  {
    question: 'Do I need to configure every provider to run locally?',
    answer:
      'No. Stripe, Sentry, PostHog, Turnstile, Cloudflare Email, and the AI providers are env-gated. Missing keys leave those providers disabled — the app still boots and the rest of the surface stays usable.'
  },
  {
    question: 'How does deployment work?',
    answer:
      'Alchemy v2 declares every Cloudflare resource — Workers, D1, Queues, Email Service, secrets — as TypeScript. The same description provisions local dev and production, so `bun run deploy` is the whole story.'
  },
  {
    question: 'Can I deploy this outside Cloudflare?',
    answer:
      'The starter is Cloudflare-first by design: D1, Workers, Queues, Email, Turnstile, and Alchemy compose into one coherent production path. Porting to another platform is possible but not a goal — expect to swap the persistence, queue, and email layers yourself.'
  },
  {
    question: 'What is the license, and can I use it commercially?',
    answer:
      'MIT. Fork it, rename it, ship it. Attribution is appreciated but not required.'
  }
]

type ChangelogEntry = {
  readonly version: string
  readonly date: string
  readonly title: string
  readonly changes: readonly string[]
}

export const changelog: readonly ChangelogEntry[] = [
  {
    version: '0.1.0',
    date: '2026-05-16',
    title: 'Initial starter decisions',
    changes: [
      'Cloudflare-first architecture',
      'Effect v4 application backbone',
      'Better Auth admin dashboard',
      'Outbound webhooks through Cloudflare Queues'
    ]
  }
]
