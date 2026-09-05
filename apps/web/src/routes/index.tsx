import { createFileRoute } from '@tanstack/react-router'
import { ClosingSection } from '@/components/landing/closing-section'
import { DemoStrip } from '@/components/landing/demo-strip'
import { HeroSection } from '@/components/landing/hero-section'
import { KnowledgeSection } from '@/components/landing/knowledge-section'
import { ProvidersSection } from '@/components/landing/providers-section'
import { RequestTraceSection } from '@/components/landing/request-trace-section'
import { PublicLayout } from '@/components/public-layout'
import { getAllPostMeta } from '@/lib/blog'
import { getAllDocMeta } from '@/lib/docs'
import { loadDemoShowcaseServerFn } from '@/lib/server/demo-showcase'

export const Route = createFileRoute('/')({
  // The knowledge section lists recent content: metadata resolves here, so
  // the compiled MDX never enters the landing page's chunk (lib/blog.ts and
  // lib/docs.ts use lazy globs). The showcase numbers come from the same
  // actorless read the REST overview endpoint serves — through a server fn,
  // and with route code splitting on (vite.config.ts), the capabilities
  // graph the fn's handler reaches never enters this page's preload: `/`
  // ships the landing's own modules only (see lib/server/demo-showcase.ts).
  loader: async () => {
    // oxlint-disable-next-line effect/noNewPromise -- TanStack loaders are promise-shaped; Promise.all keeps the three content/data reads parallel
    const [allPosts, allDocs, demo] = await Promise.all([
      getAllPostMeta(),
      getAllDocMeta(),
      loadDemoShowcaseServerFn()
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
      { title: 'B2B SaaS Starter: Cloudflare-first production starter' },
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
        <HeroSection />
        {/* `null` means the showcase workspace is missing in this deployment:
            the page renders without the numbers instead of failing. */}
        {demo === null ? null : <DemoStrip demo={demo} />}
        <RequestTraceSection overview={demo === null ? null : demo.overview} />
        <ProvidersSection />
        <KnowledgeSection recentDocs={recentDocs} recentPosts={recentPosts} />
        <ClosingSection />
      </main>
    </PublicLayout>
  )
}
