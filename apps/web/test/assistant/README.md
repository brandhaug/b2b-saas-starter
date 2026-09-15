# Persistent assistant host tests

Run from the repository root:

```sh
vp test run apps/web/src/lib/assistant/conversation-host.live.test.ts
```

The harness bundles the exported `WorkspaceAssistantConversation` with esbuild and runs the actual `AIChatAgent` in a local workerd process. Every test applies the committed D1 migrations and creates a fixture user, workspace membership, and session. The session authority row comes from the real migration trigger. The test-only dispatch worker supplies that fixture's invocation context; production routes never import it.

The OpenAI-compatible adapter talks to a controlled local SSE fixture through Miniflare's outbound service. Tests decide when output starts and ends and count provider requests. No live provider credentials or inference are used.

Recovery tests dispose the worker process and start another against the same persisted D1 and Durable Object SQLite files. Miniflare 5 requires `resourcePersistencePath` for D1 and `isolatedResourcePersistencePath` for Durable Objects; the legacy conversion drops its old per-product persistence options. The partial-output test waits until the SDK stream block contains the prefix before restarting. An unflushed displayed tail may disappear, while that saved prefix must recover once without starting inference again. Read-only SQLite inspection synchronizes this check; application behavior still goes through the real host.

The suite also covers durable acceptance, idempotency, shared admission limits, cancellation, disconnected SSE observations, snapshot fallback, native socket mutation refusal, current session and membership checks, stronger permission revisions, and deletion cleanup. Local workerd needs permission to bind localhost. Temporary storage is removed when each test scope closes.
