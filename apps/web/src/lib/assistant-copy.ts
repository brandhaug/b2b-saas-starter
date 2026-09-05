/**
 * Honest copy shown wherever the assistant would be, when no provider is
 * configured. It names the variables that enable the feature instead of
 * pretending it is broken (CLAUDE.md rule 3 — provider-light).
 *
 * Lives here — not in `lib/server/assistant.ts` — because both halves need it
 * as a value: the effects file fills the refused outcome's message, and the
 * page renders it in the unconfigured state. Owning it in either would make
 * the effects file import a value from its client-safe twin, a module cycle
 * the dead-code gate rejects. Same shape as `lib/auth-error-copy.ts`.
 */
export const ASSISTANT_UNCONFIGURED_MESSAGE =
  'The AI assistant is not enabled on this deployment. Set WORKERS_AI_ENABLED=true with the AI binding, or OPENAI_API_KEY, to turn it on.'
