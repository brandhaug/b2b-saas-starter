# Persistent assistant runtime investigation

Checked 2026-09-15. Research for [Research: Establish persistence and recovery guarantees for the assistant](https://github.com/brandhaug/b2b-saas-starter/issues/442).

The destination is an implementation-ready specification. The anchor outcome is leaving a workspace conversation and returning while its response survives a browser disconnect. This report establishes runtime options and their limits; it does not decide collaboration, retention, or autonomous execution policy.

## Findings that change the decision

All three approaches remain viable: D1 with a queued generation job, a custom Durable Object with Effect, and Cloudflare `AIChatAgent`. Durable Objects earn their place through conversation coordination and live response recovery, not through saving history alone.

Current `AIChatAgent` has more recovery machinery than the original proposal described. It persists chat and supports client reconnection; it also uses Agents fibers to detect interrupted turns and start a continuation after object restart. A continuation makes another provider call. It cannot restore the original model connection. The distinction must appear in the specification and user-facing recovery behavior. [Chat recovery](https://developers.cloudflare.com/agents/communication-channels/chat/chat-agents/#stream-recovery)

The SDK's details still matter. Pinned upstream source buffers text before durable writes, uses an in-memory turn queue, and distinguishes retained background-job acceptance from inline fibers. Adopting the SDK does not establish that every acknowledged submission runs exactly once, every displayed token survives a crash, or every business action executes once. Those are application contracts to specify and verify.

An ordinary HTTP handler followed by `waitUntil()` is insufficient for the requested guarantee: after response completion or disconnect, Workers grants at most 30 more seconds. A durable job owner must accept generation independently of the browser. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/#duration)

## Evidence and version scope

- **Repository observations** refer to `40e586f189fecf0d844e802618209a2416dc816a`. The catalog pins Effect `4.0.0-rc.112`, Alchemy `2.0.0-beta.77`, and Wrangler `4.131.0`. Agents and `@cloudflare/ai-chat` are not installed.
- **Documented behavior** refers to primary Cloudflare documentation retrieved on 2026-09-15. These are mutable documents, not service-level guarantees for every failure mode.
- **Source observations** refer to Cloudflare Agents commit [`a7b29135acf127cdf4a44114652970d0a22300de`](https://github.com/cloudflare/agents/commit/a7b29135acf127cdf4a44114652970d0a22300de), committed 2026-09-14. Its manifests say `agents` `0.23.0` and `@cloudflare/ai-chat` `0.12.0`. The npm `latest` endpoints independently returned those versions. The chat peer range is AI SDK 6 or 7 and Agents `>=0.23.0 <1.0.0`. [Chat manifest](https://github.com/cloudflare/agents/blob/a7b29135acf127cdf4a44114652970d0a22300de/packages/ai-chat/package.json), [published chat metadata](https://registry.npmjs.org/@cloudflare%2fai-chat/latest), [published Agents metadata](https://registry.npmjs.org/agents/latest)
- The published tarballs were not diffed against that commit. Source findings are pinned observations, not claims that all future compatible versions behave identically. Upstream tests were read, not executed. No runtime, provider, deployment, or billing experiment was performed.
- **Inference** below means a design consequence of those facts. **Unverified** marks evidence that the final specification or a prototype must still obtain.

## Existing application baseline

The assistant already has durable application work. [Architecture](../../ARCHITECTURE.md#assistant-tasks) describes D1-backed webhook investigation tasks, conditional approval/cancellation, a stable replay identity, queued replay execution, and delivery-derived outcomes. Closing the assistant does not stop an approved replay. These are distinct from chat.

[AssistantService](../../packages/ai/src/index.ts) accepts one question and optional bounded evidence, generates one complete answer, and disables tools. [The shared model policy](../../packages/ai/src/text-model.ts) rejects assistant-role history, tools, structured output, and streaming. Persistent multi-turn chat therefore changes the model contract regardless of storage choice. Workers AI, an OpenAI-compatible provider, and the mock must retain equivalent supported behavior.

The [background worker](../../apps/background/AGENTS.md) already consumes queues through a shared Effect boundary, including attempt accounting, tracing, acknowledgement/retry outcomes, and some dead-letter consumers. That is useful infrastructure; it is not an existing assistant job implementation.

The companion [Effect and authorization integration research](persistent-assistant-integration.md) examines the installed Effect/Alchemy persistence helpers and authorization boundaries. A custom DO need not invent transcript persistence from nothing, but those helpers' whole-history saves do not by themselves provide durable incremental generation or accepted-turn recovery.

## Define the guarantee before choosing the runtime

The following are separate acceptance conditions, not interchangeable meanings of "persistent":

| Condition                    | Observable result                                                                   | Required durable evidence                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Saved transcript             | Refresh or reopen shows the conversation                                            | Committed messages with stable identity and order                                              |
| Accepted submission          | A send acknowledged before a disconnect is eventually completed or visibly terminal | Durable submission identity, state, and recovery trigger                                       |
| Reconnect replay             | A disconnected client catches up with the still-running response                    | Ordered response events or a recoverable snapshot plus live events                             |
| Restart recovery             | A crash or deploy produces a visible recovery or interruption outcome               | Attempt identity, committed partial output, cancellation intent, and retry/continuation policy |
| Exactly-once business effect | Repeated execution cannot repeat an approved action                                 | Domain idempotency and authoritative effect evidence                                           |

This is an inferred contract decomposition. It lets the experience decision say, for example, that a transport disconnect continues silently while a provider interruption shows partial text and a visible retry. No inspected source establishes exactly-once model inference across an unknown provider failure.

## Runtime comparison

| Approach                         | What it provides                                                                                        | What this application must supply                                                                                           | Fit for the anchor outcome                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| D1 plus request-bound Worker     | Durable records and ordinary HTTP                                                                       | Almost all generation recovery; `waitUntil` is bounded                                                                      | History-only baseline; insufficient as the sole generation owner                                      |
| D1 plus Queue consumer           | Generation independent of browser, at-least-once delivery and retries                                   | Durable job admission, deduplication, per-conversation ordering, partial output protocol, cancellation, status and recovery | Viable if polling/catch-up and restarting an interrupted provider attempt meet the chosen experience  |
| Custom SQLite DO with Effect     | One coordinated owner, local transactional storage, WebSocket hibernation, alarms                       | Turn ledger, incremental output, replay protocol, recovery, timeout/cost budgets, client transport                          | Viable with control over semantics and no required model-library replacement                          |
| Agents plus `AIChatAgent`        | Chat persistence, broadcast/replay, concurrency policies, keep-alive, bounded interrupted-turn recovery | Effect integration decision, auth, admission/idempotency contract, domain actions, retention and explicit recovery UX       | Strong SDK candidate for the anchor, subject to the concrete gaps below                               |
| Workflows alongside one of these | Durable steps, retries, waits and restart from recorded step results                                    | Conversation transport, application records, idempotent step effects and final-result publication                           | Conditional addition for long or multi-step work; no need established solely by browser disconnection |

The table is a synthesis of the evidence below, not a selected architecture.

### D1 plus Workers and Queues

Queues documents at-least-once delivery, including possible duplicates. A generated message ID or application idempotency key is required where duplicate handling changes behavior. A delivered queue message is not proof that a provider completed or that a final answer committed. [Queue delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)

A consumer invocation has a 15-minute wall-clock ceiling, even while waiting for inference. Paid queues retain messages for four days by default, configurable to 14; expired messages disappear. Retries are finite. A queue therefore needs durable application status and a terminal/reconciliation path, not an indefinitely pending UI. Queue payloads should contain IDs and bounded parameters rather than the transcript. [Queue limits](https://developers.cloudflare.com/queues/platform/limits/), [queue pricing and retention](https://developers.cloudflare.com/queues/platform/pricing/)

A viable inferred design commits a user message, generation record, and dispatch intent in D1, then dispatches and retries that intent. The consumer claims the generation with an attempt identity, writes bounded progress, and conditionally publishes the final result. The reconnecting browser reads the same record and events. A stable generation key plus conditional writes prevents stale workers from overwriting a newer attempt. It cannot prevent duplicate provider billing after an ambiguous failure unless that provider offers an applicable idempotency or retrieval API.

D1 and Queue delivery do not share a transaction. Merely committing D1 and then calling `send()` leaves a failure gap. Use a recoverable dispatch intent with reconciliation, or explicitly design a queue-first acceptance protocol. Do not assume the existing webhook dispatch path already meets chat admission semantics.

Live output need not require a DO. A queue consumer could persist ordered chunks to D1 while browsers poll or use a reconnectable read stream. This is an inference, not a built-in D1 streaming feature. It adds read traffic and replay logic; it may suffice if immediate multi-viewer updates are unnecessary. Per-conversation turn ordering must come from the application, not an assumption that concurrent consumers serialize a conversation.

### Custom Durable Objects

DOs provide an authoritative owner for a named entity and storage accessible only inside that object. SQLite operations and transactions can commit message, attempt, and stream progress together. Storage gates protect storage operations; they do not make a whole async provider interaction atomic. Application code can interleave at `await` boundaries. [SQLite storage and concurrency](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)

Use the following lifecycle facts when assessing any custom design:

- Eligible objects can hibernate after about ten idle seconds. In-memory state disappears; hibernating WebSockets can remain connected.
- Timers, awaited fetches, and active events prevent hibernation. Idle non-hibernating objects can be evicted after roughly 70 to 140 seconds. Plain fetch response streams do not themselves keep objects alive.
- Deployment and runtime shutdown can terminate connections and stop storage access by an old instance. There is no dependable shutdown hook. Persist progress incrementally.

These are documented lifecycle rules, not an uninterrupted-computation promise. [DO lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)

An alarm wakes an object without a browser. Each object has one alarm slot; alarms execute at least once and automatically retry thrown failures up to six times with exponential backoff. A custom runtime must multiplex keep-alive, job recovery, timeouts, and retention in that slot. A terminal attempt needs durable evidence because the automatic retry limit is finite. [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)

Inference: a custom DO can meet the anchor by committing acceptance before acknowledging the send, maintaining ordered durable progress, and owning a recovery alarm independently of the client. A provider disconnect still ends that attempt. Recovery must mark it interrupted, retry, continue from saved text, or retrieve a provider-owned result. Choosing among those is a product and provider decision.

### Agents and AIChatAgent

The documented chat path persists incoming messages, calls `onChatMessage`, streams response events over WebSocket, and persists/broadcasts the final message. The package uses AI SDK `UIMessage` and its response stream protocol. The documented `messageConcurrency` default is `queue`; alternative policies include latest, merge, drop, and debounce. These policies affect overlapping submissions, not application authorization. [Chat agents](https://developers.cloudflare.com/agents/communication-channels/chat/chat-agents/)

The pinned implementation gives more precise evidence:

1. **Replay and durable text are different.** `ResumableStream` normally packs ten chunks into a persisted segment, with a 512,000-byte target. Text can reach live clients before the partial segment commits. A restart can therefore lose the unflushed tail. Oversized chunks above its 1,800,000-byte stored-encoding guard reach live clients but skip replay storage. Reconnection to the same live instance and recovery after process death have different loss boundaries. [Replay implementation](https://github.com/cloudflare/agents/blob/a7b29135acf127cdf4a44114652970d0a22300de/packages/agents/src/chat/resumable-stream.ts#L637)
2. **Finalization has a useful transaction boundary.** Normal cutover settles the stream, persists the final message, and removes the stream rows in one SQLite transaction. Completed replay buffers are temporary, not a permanent event archive. [Cutover implementation](https://github.com/cloudflare/agents/blob/a7b29135acf127cdf4a44114652970d0a22300de/packages/agents/src/chat/resumable-stream.ts#L566)
3. **Ordering is not durable admission.** `TurnQueue` serializes closures through an in-memory Promise chain and generation counter. Incoming messages persist before waiting for the exclusive turn. This supports in-process ordering but does not establish a retained ledger for every queued submission, deduplication after a lost acknowledgement, or replay of every pending closure after restart. [Turn queue](https://github.com/cloudflare/agents/blob/a7b29135acf127cdf4a44114652970d0a22300de/packages/agents/src/chat/turn-queue.ts), [chat request path](https://github.com/cloudflare/agents/blob/a7b29135acf127cdf4a44114652970d0a22300de/packages/ai-chat/src/index.ts#L1124)
4. **Business effects still need their own evidence.** Settled tool output is flushed immediately in the pinned chat implementation, reducing one loss window. A crash after an external action commits but before its result reaches the SDK remains ambiguous. The same is true of provider billing. [Tool-result persistence](https://github.com/cloudflare/agents/blob/a7b29135acf127cdf4a44114652970d0a22300de/packages/ai-chat/src/index.ts#L1863)

The source tests cover replay/live handshakes, acknowledgements, ordering, buffer packing, stream-finalization races, and cleanup. Recovery tests cover partial and pre-stream interruptions, recovery budgets, continuation, and duplicate recovery triggers. A deployed test forces a Worker redeploy and checks that a recovery hook fires; its polling also activates the object. That test alone does not prove unattended recovery latency or exactly-once completion. [Replay tests](https://github.com/cloudflare/agents/blob/a7b29135acf127cdf4a44114652970d0a22300de/packages/ai-chat/src/tests/resumable-streaming.test.ts), [recovery tests](https://github.com/cloudflare/agents/blob/a7b29135acf127cdf4a44114652970d0a22300de/packages/ai-chat/src/tests/durable-chat-recovery.test.ts), [deployed test](https://github.com/cloudflare/agents/blob/a7b29135acf127cdf4a44114652970d0a22300de/packages/ai-chat/src/e2e-tests/deployed-recovery.test.ts#L147)

## Recovery, cancellation, and background execution

Agents' `runFiber()` stores recovery metadata, holds a keep-alive heartbeat, and exposes application checkpoints. After restart, activation or a persisted alarm invokes recovery. The original closure and waiting caller are gone. A normally thrown exception is distinct from eviction; inline fibers do not automatically retry all exceptions. `startFiber()` adds a retained status ledger and idempotency key for background acceptance. Its cancellation records terminal intent and signals cooperative work. Neither API restores arbitrary JavaScript execution at an instruction pointer. [Durable execution with fibers](https://developers.cloudflare.com/agents/runtime/execution/durable-execution/)

The built-in `Agent.queue()` is another mechanism. It stores tasks in SQLite, processes FIFO callbacks in the object, and applies configured retries. It is not the Cloudflare Queues service and not a separate execution environment. Domain callbacks must remain safe to repeat. Avoid stacking `Agent.queue`, a queue consumer, and Workflows around the same generation unless each has a specific responsibility. [Agent queue tasks](https://developers.cloudflare.com/agents/runtime/execution/queue-tasks/)

The chat recovery defaults bound lack of progress and repeated recovery attempts, then produce a terminal result. A callback can constrain recovery using durable spend evidence. Pending client interactions are treated differently from interrupted server tools. These defaults do not constitute the application's cost or approval policy. [Recovery configuration](https://developers.cloudflare.com/agents/harnesses/think/recovery/)

Inferred cancellation contract for every option:

- Closing a tab is a disconnect, not a stop request.
- Stop requires durable cancellation intent associated with a generation, plus propagation to the provider call where supported.
- Acknowledging stop must not imply that already committed domain effects were reversed or provider charging ceased.
- Restart recovery checks cancellation before calling the model again.
- Late output from an obsolete attempt cannot overwrite a terminal or newer generation.

The documentation explicitly says an in-memory abort signal does not survive restart and advises persisting cancellation intent. Whether partial text remains visible and who can stop shared work are still human decisions. [Chat cancellation](https://developers.cloudflare.com/agents/communication-channels/chat/chat-agents/#request-cancellation)

### Where Workflows adds a distinct guarantee

Workflows persists step results and retries failed steps; completed steps need not run again when execution resumes. Calls with external effects must still be idempotent because a step can commit externally and fail before recording success. A model request placed inside one step can be repeated for the same reason. [Workflow rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)

The default step timeout is ten minutes, configurable, with retry configuration per step. A platform limit showing unlimited step wall time does not override that configured timeout. `step.waitForEvent()` and persisted waits are useful for processes that pause for approval or an external result. [Sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/), [events and parameters](https://developers.cloudflare.com/workflows/build/events-and-parameters/)

Workflows becomes a serious candidate if the specification requires resumable multi-step investigations, waits lasting hours or days, or attempts exceeding the queue consumer's 15-minute ceiling. It need not own chat transport or existing replay approvals. The current D1 task transitions and webhook queue already provide durable approval and execution evidence. "There is an approval" alone does not justify moving that work into a Workflow.

## Storage ownership and conversation identity

These are design options, not settled schema decisions.

| Boundary                | Useful ownership choice                                                                                     | Consequence                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| D1 application records  | Workspace membership, permissions, conversation directory, task references, business approvals and outcomes | Queryable workspace lists and existing domain transactions remain together                  |
| DO conversation storage | Authoritative transcript, generation attempts, short-lived replay events and runtime checkpoints            | Local atomic updates and one conversation coordinator                                       |
| Workflow storage        | Step checkpoints and execution status                                                                       | Publish necessary lasting results to the application; Workflow history has finite retention |
| Queue                   | Delivery notification referring to durable work                                                             | It is neither the transcript nor the authoritative completion record                        |

D1 and a DO have no shared transaction. If the DO owns chat, a D1 directory update can lag its actual state. Prefer an explicit recoverable projection over writing the same authoritative transcript to both stores. Creation, deletion, title updates, last-activity sorting, and task links each need a policy for failure between commits. This is an inference from the separate transaction boundaries, not a claim that a distributed transaction exists.

D1 read replicas are asynchronous. Sessions/bookmarks can provide sequential consistency when using replicas, but they cannot order a D1 observation against a separate DO commit. Membership and permission freshness require deliberate reads at the authorization boundary. [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)

Object granularity changes isolation and cost:

- **Per conversation** isolates turn ordering, failure and retention. A D1 directory or equivalent is needed to list conversations; object naming is not a workspace query API.
- **Per workspace** simplifies some shared state but puts every conversation's coordination and hot history behind one object. A busy or oversized workspace becomes one failure and throughput unit.
- **Per generation** isolates execution but requires another owner for transcript order and links between attempts. It duplicates more coordination for the chosen outcome.

A per-conversation DO is a strong candidate, not an established decision. Use immutable Workspace ID and Conversation ID in the routing/ownership scheme; workspace slugs can change. An unguessable object name is not authorization. Decide whether conversation identity is private to a member or shared before treating every connected client as an authorized transcript recipient.

### Growth, retention, and deletion

Keep three policies separate: persisted transcript retention, temporary replay retention, and model context selection. Trimming stored messages does not automatically budget the prompt, and limiting the prompt does not delete stored evidence. The AIChatAgent source exposes the entire loaded history as `this.messages`; long histories must be assessed for serialization, memory and model-token growth. [Chat implementation](https://github.com/cloudflare/agents/blob/a7b29135acf127cdf4a44114652970d0a22300de/packages/ai-chat/src/index.ts)

Specify message byte limits and bounded context before approaching the platform's row limit. Large operational evidence should remain a scoped task reference rather than an unbounded chat attachment. The current allowlisted evidence policy should survive this change.

Deleting a conversation must account for active attempts, future alarms/retries, replay data, the D1 directory, and task references. A stale queued job must not recreate a deleted conversation. Decide whether deletion is irreversible, delayed, or subject to the existing governance model. SQLite DO point-in-time recovery retains historical state for 30 days; application deletion and recoverability are different concepts. [DO storage recovery](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#point-in-time-recovery-api)

## Limits and cost model

These values were checked on 2026-09-15. They are planning inputs; quotas and account-wide included usage must be rechecked before implementation.

| Product        | Relevant documented limits on Paid                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SQLite DO      | 10 GB per object, 2 MB row, 100 bound SQL parameters, 30 seconds CPU by default configurable to five minutes, 128 MB runtime memory allocation; individual objects are single-threaded with a soft 1,000 requests/second limit |
| D1             | 10 GB per database, 2 MB row, 30-second query duration, 100 bound parameters; shared application database capacity matters                                                                                                     |
| Queue consumer | 128 KB message, 15-minute invocation wall time, up to 100 retries; paid retention up to 14 days                                                                                                                                |
| Workflows      | 1 MiB non-stream step result, 1 GiB instance state, 10,000 steps by default configurable to 25,000, paid completed-state retention 30 days                                                                                     |

[DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Queue limits](https://developers.cloudflare.com/queues/platform/limits/), [Workflow limits](https://developers.cloudflare.com/workflows/reference/limits/)

The current Workflow limits page has an inconsistency: its table lists 50,000 paid concurrent executions while explanatory prose still uses 10,000. This does not decide the starter's architecture; confirm the account limit before promising scale. The general wall-time table also uses broader DO wording than the dedicated lifecycle page about pending I/O. Rely on the lifecycle rules and test a disconnected generation, rather than assuming any fetch prevents eviction forever.

### Illustrative monthly incremental usage

Assumptions: an existing Workers Paid account; 100,000 turns/month; each occupies one DO for 60 seconds; one viewer; roughly 600 protocol chunks/turn; replay chunks are temporary; ordinary hibernation between turns; no model or third-party charges included. These are invented workload assumptions, not observed starter usage.

- DO active duration is `100,000 × 60 × 0.128 = 768,000 GB-s`. The included duration is 400,000 GB-s/month. Current pricing rounds excess duration up to the next million GB-s, so this scenario adds **$12.50**, before request/storage costs. At 10,000 otherwise identical turns, duration is within the included allocation. Slow generations and keep-alive time increase this dimension even when CPU is mostly idle. [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- One Queue message per turn under 64 KB normally consumes three operations. 100,000 turns use 300,000 operations, within the separate one-million monthly inclusion. At one million turns with no retries, three million operations add **$0.80**. Consumer CPU and Worker requests are additional. [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- Ten-chunk packing would produce about six million stream segments at the assumed chunk rate. That is not the row-write bill: stream metadata, indexes, finalization, cleanup, recovery and history rewrites add operations. Measure actual rows and memory in a selected implementation. Both DO SQL and D1 include 50 million row writes/month and charge $1 per additional million. Their retained-storage rates differ: $0.20/GB-month for DO SQL and $0.75/GB-month for D1 after their included storage. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/#sqlite-storage-backend)
- An optional Workflow with three billed steps per turn uses 300,000 steps, under its 500,000/month inclusion. Current paid overage is $0.80 per 100,000 steps; storage includes 1 GB-month then $0.20/GB-month. Requests and CPU share Workers pricing. Step/storage billing began August 10, 2026, so older estimates that treat them as free are obsolete. [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/)

All inclusions are shared account allocations, not fresh allowances per conversation. This model cannot establish a total cost advantage. Provider tokens, repeated context, duplicated attempts, logs, and recovery spend need measurement. The strongest early controls are bounded prompt context, generation budgets, capped retries and no accidental always-awake objects.

## Deployment, testing, and operations

Keep resource identity stable across deployments and isolated by stage. The repo generates Wrangler configuration from infrastructure declarations; implementation belongs there, not in generated files. Verify Alchemy's exact DO support before choosing deployment syntax. Current Wrangler docs support declarative `exports`; legacy `migrations` still works, but both cannot be used together in one Worker. The chat quick start still demonstrates `new_sqlite_classes`. Class renames and resource deletion can destroy or disconnect stored conversation state. [DO class lifecycle](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)

SQLite state and alarms can persist locally across Wrangler restarts. Cloudflare also documents runtime-native DO tests with its Vitest integration. Local tests can exercise state reconstruction, but cannot establish the deployed network path, server rollout behavior, or a real provider's cancellation and resume contract. [Fiber local testing](https://developers.cloudflare.com/agents/runtime/execution/durable-execution/#testing-locally), [DO testing](https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/)

If a prototype is needed, one broad failure experiment should answer the remaining runtime questions together:

1. Accept a send, sever the browser before the first token, leave it disconnected beyond 140 seconds, then reconnect.
2. Repeat after partial output, including a tail shorter than ten chunks, and after output commits but before client acknowledgement.
3. Kill/restart locally, then redeploy a test Worker mid-turn with no client reconnect. Measure alarm-only recovery.
4. Submit twice with the same client key, send concurrently from two clients, and crash while a second turn is queued.
5. Persist stop, kill the process before provider abort completes, and verify no recovery restarts that generation.
6. Inject provider error, hung response, budget exhaustion, D1 projection failure and replay-buffer expiry. Verify a terminal state or bounded recovery with stable identifiers.
7. Revoke access and delete the conversation while a job or connection remains active. Verify that stale clients and jobs cannot revive it.

These are proposed evidence requirements, not implemented tests or permission to choose the product semantics on the human's behalf.

Operations should correlate Workspace ID, Conversation ID, submission ID, generation/attempt ID, provider request ID where available, and any recovery incident. Measure time to first token, time to final result, disconnect recovery delay, terminal interruption rate, retries, duplicate acceptance, buffered output loss, token spend and DO active duration. Agents emits diagnostics for chat recovery, stream stalls and fibers that can feed this repo's existing wide-event system. Keep prompt/evidence bodies out of routine telemetry. [Agents diagnostics](https://developers.cloudflare.com/agents/runtime/operations/observability/diagnostics-channels/)

## Shortlist and remaining decisions

Retain **D1 plus Queues** as the simplest comparison baseline for saved conversation plus asynchronous answer completion. Disqualify a request-only implementation. If the product requires smooth stream catch-up and one conversation coordinator, compare **custom DO with Effect** against **Agents plus AIChatAgent**. Add **Workflows** only when a specified recovery, wait or multi-step behavior warrants another execution owner.

The next decision ticket can settle the following as one coherent experience and runtime choice:

- What does the acknowledgement of Send promise, and is repeat submission with the same key guaranteed to join the same generation?
- After a process/provider interruption, may the answer restart, continue with a visible boundary, or stop for the user? Must every displayed token survive?
- Are overlapping submissions rejected, queued or merged? Are conversations private, workspace-shared, or selectively shared?
- What durable cancellation, retry and spending limits apply, including unattended work?
- Which store owns chat, how does the workspace directory recover from partial writes, and how are history and deletion bounded?
- Does the chosen SDK integration cost less than owning its missing behavior? The companion integration report supplies the Effect and authorization facts.

No hard platform blocker was found for the anchor outcome. The hard evidence gaps are exact deployed disconnected/restart behavior for the selected stack, duplicate and queued-send semantics, provider-specific retry/cancellation behavior, and measured cost. Public documentation and source inspection can narrow the choice; they cannot substitute for those observations or for the human's product decisions.
