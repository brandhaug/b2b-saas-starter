# Persistent assistant host tests

Run from the repository root:

```sh
pnpm -C apps/web exec vp test run src/lib/assistant/conversation-host.live.test.ts
```

The harness bundles the exported `WorkspaceAssistantConversation` with esbuild and runs the actual `AIChatAgent` in a local workerd process. Every test applies the committed D1 migrations and creates a fixture user, workspace membership, and session. The session authority row comes from the real migration trigger. The test-only dispatch worker supplies that fixture's invocation context; production routes never import it.

The OpenAI-compatible adapter talks to a controlled local SSE fixture through Miniflare's outbound service. Tests decide when output starts and ends and count provider requests. No live provider credentials or inference are used.

Recovery tests dispose the worker process and start another against the same persisted D1 and Durable Object SQLite files. Miniflare 5 requires `resourcePersistencePath` for D1 and `isolatedResourcePersistencePath` for Durable Objects; the legacy conversion drops its old per-product persistence options. The partial-output test waits until the SDK stream block contains the prefix before restarting. An unflushed displayed tail may disappear, while that saved prefix must recover once without starting inference again. Read-only SQLite inspection synchronizes this check; application behavior still goes through the real host.

The suite also covers durable acceptance, idempotency, shared admission limits, cancellation, disconnected SSE observations, snapshot fallback, native socket mutation refusal, current session and membership checks, stronger permission revisions, and deletion cleanup. Local workerd needs permission to bind localhost. Temporary storage is removed when each test scope closes.

## Pending-I/O protection verification

The harness consumes `workerCompatibility` from `infra/bindings.ts`, including
`durable_object_io_tasks_prevent_eviction`. Alchemy, generated Wrangler configs
and the local development runtime use the same configuration. The compatibility
date stays `2026-05-16`.

Verified locally on 2026-10-03 with Miniflare `5.20260926.1-alpha`, workerd
`1.20260926.1`, Wrangler `4.144.0` and Alchemy `2.0.0-beta.79`. The 27 native host
tests passed both before and after enabling the flag, and both shared-execution
tests passed before the change. The test pool's older August runtime rejected
the flag, so scoped dependency overrides align its Miniflare and Wrangler with
the workspace catalog.

The native suite verifies completion without observers, disconnect/reconnect
replay without another provider request, explicit Stop, authority interruption,
process restart with saved partial output, and explicit Retry. The shared
execution deadline has a separate deterministic regression:

```sh
pnpm -C packages/capabilities exec vp test run src/developer-platform/assistant-conversation-execution.seed.test.ts
E2E_PORT=3191 pnpm run validate
```

Local validation cannot establish Cloudflare's deployed idle-eviction timing or
duration billing. The controlled provider uses external fetch, which already
prevents eviction even without the flag. A deployed verification must also leave
only pending `waitUntil`, binding/RPC or timer work after the last client closes,
then reconnect and confirm the same attempt completes without new inference.
Verify Stop, deadline expiry and forced restart separately; restart must record
Interrupted/process and require explicit Retry. See
[ADR 0009](../../../../docs/adr/0009-no-durable-objects-without-coordination-need.md)
for the per-operation protection limit and billing trade-off.
