import { Link } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { SnippetPanel } from '@/components/landing/snippet-panel'

const MCP_SNIPPET = `{
  "name": "b2b-saas-starter-mcp",
  "resources": ["workspace://overview"],
  "tools": [
    { "name": "list_notifications", ... },
    { "name": "get_workspace_overview", ... },
    { "name": "list_audit_events", ... }
  ]
}`

function CapabilitySection({ overviewJson }: { readonly overviewJson: string }) {
  return (
    <section className="band-deep bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:py-28">
        <div className="max-w-2xl">
          <h2 className="font-display text-balance text-3xl font-semibold sm:text-4xl">
            Write the capability once. Serve it three ways.
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
            Server functions in the web app, REST endpoints, and MCP discovery all call
            the same typed services in{' '}
            <code className="font-mono text-sm text-signal">packages/capabilities</code>
            . No duplicated business behavior, no drift between surfaces.
          </p>
        </div>
        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          {/* The response body below the curl line is the real `overview`
              payload the route loader read for the seed workspace — the page
              and the API cannot drift because they are the same bytes. */}
          <SnippetPanel
            label="REST · GET /workspaces/:slug/overview"
            code={`curl -H "Authorization: Bearer bsk_live_xxx" \\\n  https://api.example.com/workspaces/starter-lab/overview\n\n${overviewJson}`}
          />
          <SnippetPanel label="MCP · discovery" code={MCP_SNIPPET} />
        </div>
        <Link
          to="/docs/$category/$slug"
          params={{ category: 'capability-interfaces', slug: 'rest-api' }}
          className="mt-8 inline-flex items-center gap-1.5 text-sm text-foreground underline-offset-4 hover:underline"
        >
          Read the API contract
          <ArrowRightIcon className="size-3.5" />
        </Link>
      </div>
    </section>
  )
}

export { CapabilitySection }
