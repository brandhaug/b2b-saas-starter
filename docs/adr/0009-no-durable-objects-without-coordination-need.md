# Durable Objects require a coordination need

The persistent assistant design
establishes a concrete coordination need: one active answer per private
conversation, shared progress across its creator's tabs, and replay after browser
disconnection. One SQLite Durable Object with AIChatAgent owns each conversation.
The web Worker exports the host class; API and background Workers bind to that
same host within their isolated stage.

The shared Worker configuration enables `durable_object_io_tasks_prevent_eviction`
at compatibility date `2026-05-16`, in Alchemy and generated Wrangler configs for
every stage. No application feature flag is needed. The host already registers
answer completion, publication and flush promises with `ctx.waitUntil`.
[Cloudflare's pending-I/O protection](https://developers.cloudflare.com/changelog/post/2026-10-01-pending-io-keep-alive/)
keeps those operations, service binding requests, Durable Object RPC and timers
from idle eviction after clients disconnect. External `fetch()` already prevents
eviction. Each pending operation protects for up to 15 minutes; later operations
can extend total residency, and duration billing continues during protection.

The default answer deadline remains 10 minutes. Explicit Stop, current-authority
checks and deadline aborts still terminate application work. This runtime behavior
does not provide durable crash recovery. `onStart` still records active attempts
as Interrupted with a process reason, and only explicit Retry starts new inference.

D1 keeps immutable creator and Workspace identity, required permissions and policy
revision, deletion fences, export manifests and shared Member admission. A single
conditional insert enforces active-answer and rolling-minute limits across
objects and transports. No per-Member object or Workflow is needed.

Conversation objects serialize acceptance and persist input, deadlines and
idempotency before returning 202. SDK in-memory queues never authorize an answer.
Browser reconnection observes the existing attempt. Process interruption records
Interrupted and requires explicit Retry, preserving saved partial text but
potentially losing the most recent unflushed tail. The
accepted prototype
established that integration locally; deployed and real-provider validation is
separate evidence.

Every snapshot and stream batch checks current authority and its content policy
revision. Deletion fences block access and new admission before asynchronous
object destruction; durable addresses survive parent deletion and cleanup.
Background retry and recovery sanitation preserve those fences.

Other features still need their own concrete coordination requirement before
adding Durable Objects or realtime transport. General autonomous-agent execution,
Workflows, shared conversation editing and an application-wide realtime platform
remain outside this use case.
