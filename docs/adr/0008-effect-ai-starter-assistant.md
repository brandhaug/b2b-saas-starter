# Effect AI starter assistant

Effect owns model execution, context construction, typed failures, deadlines and
interruption. Workers AI and OpenAI-compatible adapters accept system, user and
assistant text history and stream text, metadata, finish and usage events. Tools
and unsupported model parts fail explicitly. Provider selection never falls back
after a configured provider fails.

Both answer paths share unconditional action and evidence instructions. Stateless
inference has a 60-second deadline covering response consumption and requests
4,096 output tokens by default. Provider-reported incomplete output fails through
the existing unavailable contract. Missing completion metadata remains unknown;
the application cannot determine truncation from answer text alone.
OpenAI cancellation covers fetch and response consumption;
the Workers binding cannot guarantee cancellation of already-started provider work.

Persistent context includes up to three recent interruption observations after
current authorization. Only fixed application failure categories and attempt and
question identities enter these observations. Partial answers, failed task evidence
and raw diagnostics stay out. Optional observations yield to the current question
when the context budget is full.

The persistent assistant design
uses AIChatAgent for saved messages and reconnectable streaming in one conversation
Durable Object. A small adapter maps Effect events to the AI SDK UI-message
Response contract. SDK wire types stay at the host integration; existing Assistant
Tasks, approvals and application services retain their ownership.

D1 owns the conversation directory, monotonic evidence permissions, deletion
fences and shared Member quotas. The object owns durable accepted input, attempt
identity, lifetime idempotency and the transcript. Acceptance reserves a D1 slot,
persists input in the object and commits the reservation before generation.
Ambiguous failures remain bounded by the attempt deadline and shutdown grace.

Reconnect reads saved history and active progress without a model call. Process
or provider interruption preserves saved partial output and requires explicit
Retry. Automatic continuation is disabled, including before the first token.
AIChatAgent batches writes, so the most recent displayed but unflushed text can
be lost. Stop records its terminal state before acknowledgement and propagates
cancellation; provider billing may continue when cancellation is not guaranteed.
The object durably records which attempt still has output to finalize. Recovery
restores that attempt's saved replay text even after Stop or access revocation,
preserves its terminal outcome, and fences new execution until restoration finishes.

Persistent generation refuses with an unavailable response when no provider is
configured. Browsing and management remain available. Mock generation is explicit
test/demo behavior; the existing stateless `/assistant/answer` contract is unchanged.
Local contract tests do not establish deployed recovery or real-provider behavior.
