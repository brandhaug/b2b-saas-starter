import { createFileRoute } from '@tanstack/react-router'
import { CapabilitySection } from '@/components/landing/capability-section'
import { ClosingSection } from '@/components/landing/closing-section'
import { HeroSection } from '@/components/landing/hero-section'
import { KnowledgeSection } from '@/components/landing/knowledge-section'
import { ProvidersSection } from '@/components/landing/providers-section'
import { RuntimeMapSection } from '@/components/landing/runtime-map-section'
import { PublicLayout } from '@/components/public-layout'
import { getAllPostMeta } from '@/lib/blog'
import { getAllDocMeta } from '@/lib/docs'
import { DEMO_WORKSPACE_SLUG } from '@/lib/demo-workspace'

export const Route = createFileRoute('/')({
  // The knowledge section lists recent content: metadata resolves here, so
  // the compiled MDX never enters the landing page's chunk (lib/blog.ts and
  // lib/docs.ts use lazy globs).
  loader: async () => {
    // oxlint-disable-next-line effect/noNewPromise -- TanStack loaders are promise-shaped; Promise.all keeps the two content reads parallel
    const [allPosts, allDocs] = await Promise.all([getAllPostMeta(), getAllDocMeta()])
    return {
      recentPosts: allPosts.slice(0, 3),
      recentDocs: allDocs.slice(0, 4)
    }
  },
  component: HomePage,
  head: () => ({
    meta: [
      { title: 'B2B SaaS Starter — Cloudflare-first production starter' },
      {
        name: 'description',
        content:
          'A reference B2B SaaS starter with TanStack Start, Effect v4, Drizzle D1, Better Auth, REST and MCP, Cloudflare Email, Stripe-ready billing, audit events, and Storybook.'
      },
      { property: 'og:title', content: 'B2B SaaS Starter' },
      {
        property: 'og:description',
        content:
          'A reference B2B SaaS starter with TanStack Start, Effect v4, Drizzle D1, Better Auth, REST and MCP, Cloudflare Email, Stripe-ready billing, audit events, and Storybook.'
      }
    ]
  })
})

function HomePage() {
  const { recentDocs, recentPosts } = Route.useLoaderData()
  return (
    <PublicLayout>
      <main id="main-content">
        <HeroSection workspaceSlug={DEMO_WORKSPACE_SLUG} />
        <CapabilitySection />
        <RuntimeMapSection />
        <ProvidersSection />
        <KnowledgeSection recentDocs={recentDocs} recentPosts={recentPosts} />
        <ClosingSection workspaceSlug={DEMO_WORKSPACE_SLUG} />
      </main>
    </PublicLayout>
  )
}
