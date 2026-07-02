import { Activity, BarChart3, CreditCard, Mail } from 'lucide-react'
import { GithubIcon } from '@/components/icons/github'

export const publicLinks = [
  { to: '/docs', label: 'Docs' },
  { to: '/blog', label: 'Blog' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/faq', label: 'FAQ' }
] as const

export const optionalProviderModules = [
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
    role: 'Product analytics in the web Worker',
    icon: BarChart3
  },
  {
    id: 'cloudflare-email',
    name: 'Cloudflare Email',
    role: 'Outbound transactional email',
    icon: Mail
  },
  {
    id: 'github-oauth',
    name: 'GitHub OAuth',
    role: 'Example OAuth Provider',
    icon: GithubIcon
  }
] as const

export const faqItems = [
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
    question: 'How do I add a new starter module?',
    answer:
      'Add the capability in packages/capabilities, register it in the starter module catalog, surface it on the workspace dashboard, and (optionally) expose it through REST and MCP. The module-state pattern handles disabled, needs-config, and ready transitions for you.'
  },
  {
    question: 'Do I need to configure every provider to run locally?',
    answer:
      'No. Stripe, Sentry, PostHog, Turnstile, Cloudflare Email, GitHub OAuth, and the AI providers are env-gated. Missing keys keep the module in a needs-config state — the app still boots and the rest of the surface stays usable.'
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
] as const

export const changelog = [
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
] as const
