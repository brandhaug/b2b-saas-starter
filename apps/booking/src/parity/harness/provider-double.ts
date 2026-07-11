export type ProviderOutcome =
  | { readonly status: 'disabled' }
  | { readonly status: 'needs-configuration' }
  | { readonly status: 'success'; readonly value?: unknown }
  | { readonly status: 'retryable-failure' | 'terminal-failure'; readonly code: string }

export const createProviderDouble = (
  provider: string,
  outcomes: Readonly<Record<string, ProviderOutcome>>
) => ({
  async invoke(operation: string, _input: unknown): Promise<ProviderOutcome> {
    const outcome = outcomes[operation]
    if (!outcome) throw new Error(`Undeclared ${provider} operation: ${operation}`)
    return structuredClone(outcome)
  }
})
