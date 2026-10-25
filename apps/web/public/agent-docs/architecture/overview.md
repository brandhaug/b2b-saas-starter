# Architecture overview

How the web worker, API worker, background worker, D1, conversation Durable Objects, and Effect capabilities fit together.

Canonical: /en/docs/architecture/overview
Source: apps/web/content/docs/architecture/overview.mdx
Language: en

The web, API, and background Workers share D1 and the Effect services in
`packages/capabilities`. HTTP contracts live in `packages/api`; request logging
lives in `packages/logger`.

Architecture paths:

* Browser → web (TanStack Start) → packages/capabilities
* HTTP client → api (REST + MCP) → packages/capabilities
* MCP client → api (REST + MCP) → packages/capabilities
* Queue jobs → background (queue consumer) → packages/capabilities
* packages/capabilities → D1, Durable Objects, Queues, Email

The web Worker calls capabilities in-process. External clients use the API
Worker. Both enforce the shared permission rules in `packages/authz`.

Capabilities select D1-backed Live adapters when a `DB` binding exists and
in-memory Seed adapters otherwise. Local development uses persisted local D1;
Seed adapters let capability tests run without a Worker.

Private Assistant Conversations use one SQLite Durable Object in the web Worker for saved history and replay. D1 owns directory identity, content permissions, deletion fences and shared Member admission; Effect owns model execution. The API and background Workers bind to the same host within their stage.

The background Worker consumes queues, handles Stripe webhooks, and runs
scheduled reconciliation, email digests, and cleanup. Keeping this work outside
page requests lets it retry independently. See [Workers](/agent-docs/architecture/workers.md)
for the entry points.

Follow [First business feature](/agent-docs/getting-started/first-business-feature.md) to add
a workspace-owned resource through D1, Effect adapters, permissions, UI, and REST.
