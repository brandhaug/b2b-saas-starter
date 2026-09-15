# Durable Objects require a coordination need

The persistent assistant design
establishes a concrete coordination need: one active answer per private
conversation, shared progress across its creator's tabs, and replay after browser
disconnection. One SQLite Durable Object with AIChatAgent owns each conversation.
The web Worker exports the host class; API and background Workers bind to that
same host within their isolated stage.

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
