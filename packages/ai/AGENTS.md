# @b2b-saas-starter/ai

Effect `LanguageModel` adapters own inference. `AssistantService.ask` retains the stateless endpoint contract. `ConversationModel.prepare` constructs bounded history before durable admission; `ConversationModel.stream` executes the accepted request. The host owns deadlines, attempt persistence, SDK wire events and interruption decisions.

## Contracts

- `provider-selection.ts` owns provider precedence: enabled Workers AI with its binding, then an OpenAI key, then mock. Stateless ask retains its mock fallback. Persistent generation refuses the mock selection before admission; `MockConversationModelLayer` is explicit demo/test behavior.
- Every adapter uses `Model.make`. Provider/model metadata comes from that context and provider response metadata, including request references when supplied. Unknown usage stays absent.
- `text-model.ts` accepts system, user and assistant text only. Tools, structured output and unsupported provider parts fail explicitly before they can become conversation prose.
- Callers pass only currently authorized completed exchanges to `prepare`, with one successful answer per question. Incomplete attempts and unanswered questions stay in saved history. Historical task evidence retains task/source IDs and observation time.
- Context budgeting uses a conservative UTF-8 byte token ceiling plus message framing. It removes whole oldest exchanges, reports `omittedExchanges`, and never shortens the current question/evidence. Provider output capacity is reserved within the context window.
- Built-in provider ceilings can be lowered by configuration. Custom OpenAI-compatible models/endpoints require explicit context/output ceilings. The persistent Workers model uses the fp8 model and a conservative 4096-token output policy; stateless model selection stays unchanged.
- Stream finish metadata may precede a typed failure, particularly `output-limit`. Only successful stream completion permits a Completed attempt. Preserve typed failure and Effect interruption; inference never retries automatically.

## Boundaries

- Callers supply `ProviderEnv`; this package reads no process environment or Worker binding directly.
- Adapter failures use `AiError`. The stateless boundary maps them to `AssistantUnavailable`; the conversation boundary exposes safe `ConversationModelFailure` data without raw provider diagnostics.
- OpenAI streaming scopes an AbortController around fetch and response consumption. Workers AI cancels its response reader; its binding provides no provider billing or cancellation guarantee before the response stream exists.
- Keep SDK UI-message types beside the host. This package exports application events and Effect streams.
- Provider token limits use `max_tokens`, usage and finish reasons. The separate response byte cap detects a malformed/oversized provider response; it is not a token counter.

## Task evidence

The caller rechecks task permissions and constructs bounded evidence without payloads, headers, response bodies or destination URLs. Evidence is data, and chat cannot approve a replay. `usedTools` stays empty for stateless replies until tools are deliberately supported.
