# @b2b-saas-starter/ai

The starter assistant on Effect's provider-agnostic `LanguageModel` (ADR 0008). `src/index.ts` holds the contract (`AssistantPrompt`, `AssistantReply`, `AssistantUnavailable`, `AssistantService`), the one `ask` implementation, and the env-driven provider choice. Each provider is a `LanguageModel` adapter in its own module: `workers-ai.ts`, `openai.ts`, `mock.ts`.

## Contracts

- Which model answers is a layer decision, never a branch inside `ask`. Every adapter is wrapped in `Model.make`, so `ProviderName` and `ModelName` arrive from the same context as the model, and the reply's `provider` / `modelId` cannot disagree with what answered.
- `selectProvider` is the one place the "is the assistant configured" condition lives: Workers AI with its binding, then an OpenAI key, then the mock. `isAssistantConfigured` reads the same choice, so the UI's "not enabled" copy cannot drift from the ask path.
- `text-model.ts`'s `plainChat` is the shared acceptance policy: system and user text messages only. Tools and structured output are refused with a typed `AiError` before a request is sent, so all three adapters accept exactly the same requests.
- `ProviderEnv` `Pick`s from `ServerEnv` (see [env](../env/AGENTS.md)); every key is `| undefined` so a worker can pass its whole env bag through.

## Boundaries

- Never read `process.env` or a binding here; the caller passes `ProviderEnv`.
- Never add a second error channel: `AiError` is the adapters' channel and `ask` is the one boundary that maps it to `AssistantUnavailable` (503).
- Unset providers select the mock rather than failing — an unconfigured deployment answers honestly instead of 500ing.

## Pitfalls

- `usedTools` is honestly empty because `toolChoice: 'none'` and every adapter refuses tools. Populate it only when tools actually land.
- `ProviderName` crosses a context boundary as a plain string, so `ask` guards it against the literal union rather than trusting it.
