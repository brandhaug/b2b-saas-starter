import { createFileRoute } from '@tanstack/react-router'
import { ClosingSection } from '@/components/landing/closing-section'
import { DemoStrip } from '@/components/landing/demo-strip'
import { FaqSection } from '@/components/landing/faq-section'
import { HeroSection } from '@/components/landing/hero-section'
import { KnowledgeSection } from '@/components/landing/knowledge-section'
import { ProvidersSection } from '@/components/landing/providers-section'
import { RequestTraceSection } from '@/components/landing/request-trace-section'
import { PublicLayout } from '@/components/public-layout'
import { getAllDocMeta } from '@/lib/docs'
import { loadDemoShowcaseServerFn } from '@/lib/server/demo-showcase'
import { m } from '@b2b-saas-starter/i18n/messages'
import newsreaderLatinWoff2 from '@fontsource-variable/newsreader/files/newsreader-latin-opsz-normal.woff2?url'

export const Route = createFileRoute('/')({
  // The knowledge section lists recent content: metadata resolves here, so
  // the compiled MDX never enters the landing page's chunk (lib/docs.ts uses
  // a lazy glob). The showcase numbers come from the same
  // actorless read the REST overview endpoint serves — through a server fn,
  // and with route code splitting on (vite.config.ts), the capabilities
  // graph the fn's handler reaches never enters this page's preload: `/`
  // ships the landing's own modules only (see lib/server/demo-showcase.ts).
  loader: async () => {
    // oxlint-disable-next-line effect/noNewPromise -- TanStack loaders are promise-shaped; Promise.all keeps the three content/data reads parallel
    const [allDocs, demo] = await Promise.all([
      getAllDocMeta(),
      loadDemoShowcaseServerFn()
    ])
    return {
      recentDocs: allDocs.slice(0, 4),
      demo
    }
  },
  component: HomePage,
  head: () => ({
    meta: [
      { title: m.landing_tagline() },
      {
        name: 'description',
        content: m.landing_description()
      },
      { property: 'og:title', content: m.landing_tagline() },
      {
        property: 'og:description',
        content: m.landing_description()
      }
    ],
    links: [
      // Newsreader is the landing page's display face. Keeping this hint on
      // the route means auth, docs, and workspace visits do not fetch it.
      {
        rel: 'preload',
        href: newsreaderLatinWoff2,
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous'
      }
    ]
  })
})

function HomePage() {
  const { recentDocs, demo } = Route.useLoaderData()
  return (
    <PublicLayout>
      <main id="main-content">
        <HeroSection showDemo={demo !== null} />
        {/* `null` means the showcase workspace is missing in this deployment:
            the page renders without the numbers instead of failing. */}
        {demo === null ? null : <DemoStrip demo={demo} />}
        <RequestTraceSection overview={demo === null ? null : demo.overview} />
        <ProvidersSection />
        <KnowledgeSection recentDocs={recentDocs} />
        <FaqSection />
        <ClosingSection showDemo={demo !== null} />
      </main>
    </PublicLayout>
  )
}
