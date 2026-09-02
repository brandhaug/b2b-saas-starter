import { createFileRoute } from '@tanstack/react-router'
import { CapabilitySection } from '@/components/landing/capability-section'
import { ClosingSection } from '@/components/landing/closing-section'
import { DemoStrip } from '@/components/landing/demo-strip'
import { HeroSection } from '@/components/landing/hero-section'
import { KnowledgeSection } from '@/components/landing/knowledge-section'
import { ProvidersSection } from '@/components/landing/providers-section'
import { RuntimeMapSection } from '@/components/landing/runtime-map-section'
import { PublicLayout } from '@/components/public-layout'
import { getAllPostMeta } from '@/lib/blog'
import { getAllDocMeta } from '@/lib/docs'
import { DEMO_WORKSPACE_SLUG } from '@/lib/demo-workspace'
import { loadDemoShowcase } from '@/lib/server/demo-showcase'

export const Route = createFileRoute('/')({
  // The knowledge section lists recent content: metadata resolves here, so
  // the compiled MDX never enters the landing page's chunk (lib/blog.ts and
  // lib/docs.ts use lazy globs). The showcase numbers come from the same
  // actorless read the REST overview endpoint serves, so the stats strip and
  // the REST snippet show the seed workspace's real data.
  loader: async () => {
    // oxlint-disable-next-line effect/noNewPromise -- TanStack loaders are promise-shaped; Promise.all keeps the three content/data reads parallel
    const [allPosts, allDocs, demo] = await Promise.all([
      getAllPostMeta(),
      getAllDocMeta(),
      loadDemoShowcase()
    ])
    return {
      recentPosts: allPosts.slice(0, 3),
      recentDocs: allDocs.slice(0, 4),
      demo
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
  const { recentDocs, recentPosts, demo } = Route.useLoaderData()
  return (
    <PublicLayout>
      <main id="main-content">
        <HeroSection workspaceSlug={DEMO_WORKSPACE_SLUG} />
        {/* `null` means the showcase workspace is missing in this deployment:
            the page renders without the numbers instead of failing. */}
        {demo === null ? null : <DemoStrip demo={demo} />}
        <CapabilitySection
          overviewJson={
            demo === null
              ? '{ "workspace": { "slug": "starter-lab", "name": "Starter Lab" } }'
              : JSON.stringify(demo.overview, null, 2)
          }
        />
        <RuntimeMapSection />
        <ProvidersSection />
        <KnowledgeSection recentDocs={recentDocs} recentPosts={recentPosts} />
        <ClosingSection workspaceSlug={DEMO_WORKSPACE_SLUG} />
      </main>
    </PublicLayout>
  )
}
