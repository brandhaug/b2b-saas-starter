import { createFileRoute } from '@tanstack/react-router'
import { Effect } from 'effect'
import { CapabilitySection } from '@/components/landing/capability-section'
import { ClosingSection } from '@/components/landing/closing-section'
import { HeroSection } from '@/components/landing/hero-section'
import { KnowledgeSection } from '@/components/landing/knowledge-section'
import { ModuleManifestSection } from '@/components/landing/module-manifest-section'
import { ProvidersSection } from '@/components/landing/providers-section'
import { RuntimeMapSection } from '@/components/landing/runtime-map-section'
import { PublicLayout } from '@/components/public-layout'
import { runWorkspaceCapabilities } from '@/lib/capabilities'
import { DEMO_WORKSPACE_SLUG } from '@/lib/demo-workspace'
import { StarterModuleCatalog, WorkspaceContext } from '@b2b-saas-starter/capabilities'

export const Route = createFileRoute('/')({
  // Public showcase: no actor — a trusted server-side read of the demo
  // workspace, not a user-scoped one.
  loader: () =>
    runWorkspaceCapabilities(
      DEMO_WORKSPACE_SLUG,
      Effect.gen(function* () {
        const catalog = yield* StarterModuleCatalog
        const ctx = yield* WorkspaceContext
        const modules = yield* catalog.listModules
        return {
          workspace: ctx.workspace,
          modules
        }
      })
    ),
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
  const { workspace, modules } = Route.useLoaderData()

  return (
    <PublicLayout>
      <main id="main-content">
        <HeroSection workspaceSlug={workspace.slug} />
        <ModuleManifestSection workspaceSlug={workspace.slug} modules={modules} />
        <CapabilitySection />
        <RuntimeMapSection />
        <ProvidersSection />
        <KnowledgeSection />
        <ClosingSection workspaceSlug={workspace.slug} />
      </main>
    </PublicLayout>
  )
}
