# PROTOTYPE: AIChatAgent with Effect

## Question and verdict

Can AIChatAgent own saved conversation messages and reconnectable output while Effect owns model execution?

**Yes, the local integration works.** The adapter returns the AI SDK UI-message `Response` that AIChatAgent expects, using Effect's `LanguageModel.streamText` as its source. No AI SDK model provider or inference execution is needed. The SDK still defines the wire protocol and message representation.

This is evidence for the proposed architecture, pending human review. It is throwaway code with synthetic identities and scratch SQLite storage. Do not deploy it or copy its auth endpoints into the application.

## Run it

From this directory, after installing the repository's pinned toolchain:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://127.0.0.1:8797>. Use **Start walkthrough in a new conversation**, then the numbered controls. The page displays live text, saved messages, attempt states and model-start evidence. A second tab can use the same conversation name.

Persistence is the subject of this probe, so the HTML page connects to a real local SQLite Durable Object. Generation is deterministic; no provider credentials or model spend are involved. State is under `.prototype-state/`. Remove that directory only when this scratch Worker is stopped and you want to discard the probe's data.

Pinned dependencies are `@cloudflare/ai-chat` 0.12.0, `agents` 0.23.0, `ai` 7.0.101 and Effect 4.0.0-rc.112. Wrangler is 4.131.0. The repository build uses Alchemy 2.0.0-beta.77. Exact transitive dependencies are in the lockfile.

## Observed on 2026-09-15

| Walkthrough                                   | Result                                                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disconnect before first token, then reconnect | Completed with one model execution, one saved answer and replayed frames.                                                                                                       |
| Repeat the same send while busy               | Joined the accepted answer. A distinct send returned 409.                                                                                                                       |
| Second turn                                   | Effect received prior user and assistant messages plus the new question.                                                                                                        |
| Deliberate typed provider error               | Interrupted, with seven chunks saved. No automatic new execution.                                                                                                               |
| Explicit Retry                                | One new execution, with the prior interrupted attempt retained.                                                                                                                 |
| Stop                                          | Effect interrupted; five partial chunks remained and the attempt was Stopped.                                                                                                   |
| Private access                                | Other member and workspace-token fixtures received 404. Revocation denied further history and sends and closed the existing socket with 1008.                                   |
| Native chat mutations                         | Clear-history and replacement-history frames were refused without modifying saved messages. The fixture admits only resume request/ack frames.                                  |
| 146 seconds disconnected                      | No requests to that conversation during the gap. Reconnection replayed output; all 180 chunks completed with one model execution and no recovery call.                          |
| Abrupt process loss during output             | Killed the scratch workerd process. After restart, 331 characters were recovered, status was Interrupted, and model-start count stayed one. Explicit Retry increased it to two. |
| Abrupt loss before first token                | Interrupted with no partial text and no automatic execution. Explicit Retry started one new execution.                                                                          |

An earlier kill after only one text chunk recovered no text. The SDK batches persistence, so a displayed but unflushed tail can disappear after process loss. The product promise must say **saved partial output**, not every character ever displayed.

Machine-readable results are [observations.json](observations.json), [disconnect-observation.json](disconnect-observation.json), and [restart-observations.json](restart-observations.json). These are observations from walkthroughs, not a production test suite.

```sh
node observe.mjs
node observe-disconnect.mjs
node observe-restart.mjs start --kill-local-runtime
```

The last command identifies exactly one inspector-enabled workerd process under this directory and kills it. Stop the remaining Wrangler launcher, run `pnpm dev` with the same state directory, then run:

```sh
node observe-restart.mjs inspect
```

## What the application needs around the SDK

- A durable admission ledger before asynchronous generation starts. It owns idempotency, one active attempt, terminal status and the mapping to the SDK request/message IDs. The SDK's in-memory queue is insufficient for accepted-send recovery.
- A narrow Effect-to-UI-message adapter for the approved text, metadata, finish, typed failure and cancellation contract. Unsupported parts must fail explicitly. This probe emits no tool calls.
- `onChatRecovery` returning `{ continue: false }`, including interruption before the first token. Reconnection replays stored output; it does not mean starting another model invocation.
- Authorization before entering SDK HTTP/WebSocket dispatch, plus checks on existing connections. AIChatAgent installs wrappers in its constructor. Overriding an application handler alone does not necessarily guard native SDK message/history paths.
- A reviewed mutation allowlist. This probe sends all mutations through one HTTP admission path and uses sockets only for observation/replay.
- Application-owned interrupted/stopped status. In this version, writing a UI `abort` chunk and reaching EOF can make `saveMessages()` report `completed`; the ledger must not overwrite an already terminal application outcome.

The local cancellation warning initially appeared to be an adapter issue. It came from nonempty responses to unread fixture request bodies, matching [workerd's reported behavior](https://github.com/cloudflare/workerd/issues/918). Consuming those fixture bodies removed it. The unrestricted scratch body drain is not a production request-size policy.

## TanStack and Alchemy integration

This branch adds a throwaway named export in `apps/web/src/server.ts`. The normal web build retains `AssistantPrototype`. Agents imports `cloudflare:email`, so the existing deployment plugin needed to externalize native `cloudflare:*` imports during the Cloudflare SSR build. Both edits belong only to this probe branch.

These checks passed:

- Prototype TypeScript check, `pnpm typecheck`.
- Real web build, from `apps/web`: `B2B_STARTER_USE_WORKERS_SHIM=0 ../../node_modules/.bin/vp build`.
- Standalone bundle, `pnpm bundle`.
- Built web bundle: `pnpm exec wrangler deploy --dry-run --config wrangler-web-build.jsonc --outdir .prototype-build/web`. It recognized the named Durable Object binding.
- `node alchemy-binding-probe.mjs` exercised the installed Alchemy binding conversion. `DurableObject('AssistantPrototype')` became `durable_object_namespace` metadata with the matching class name. [Observed metadata](alchemy-binding-observation.json).
- Browser walkthrough displayed all 40 generated chunks, saved completion and Bob's denied history read.

The Alchemy probe uses its internal conversion function with a local recording resource. It does not evaluate or deploy the complete application stack. Implementation must add the host binding and SQLite migration to Alchemy and the generated Wrangler configuration, connect the API/background consumers to the same host, and verify deployed behavior. The existing generator currently has no Durable Object configuration.

`pnpm run check` passed repository typechecking, then failed lint with 154 findings confined to these throwaway prototype files. Expected examples include native Promise/try/catch fixture code, assertions and unsupported-part throws. Checks after lint did not run. This branch is an experiment for review, not a merge-ready implementation; repository checks were not disabled to make it appear ready.

## Limits of the evidence

Alice and Bob are static fixtures. This does not verify real session validation, OAuth issuance/refresh/revocation, origin protections, role/evidence checks or privacy under a concurrent membership change. It does not implement retention, deletion, exports, production rate/context budgets, telemetry or Seed/Live parity.

Retry creates a fresh fixture send. Final retry grouping and which earlier messages enter model context remain specification decisions. No deployed runtime, real provider adapter, provider cancellation/billing behavior or region migration was tested. The one active answer, persistence and replay evidence comes from the real SDK running locally, with these limits.
