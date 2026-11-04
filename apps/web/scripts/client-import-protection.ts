// Start checks the resolved, post-compilation import graph, including re-exports
// and dynamic imports. Handler imports stripped by the compiler are not browser
// dependencies. Keep these rules shared with the real-build regression fixtures.
export const clientImportProtection = {
  behavior: 'error' as const,
  // Workspace packages are outside the app's src directory. Inspect their edges
  // too, so a shared contract cannot become a bridge into server execution.
  include: [/\.(?:[cm]?[jt]sx?|mdx?)$/],
  client: {
    specifiers: [
      /^cloudflare:/,
      /^node:/,
      /^@b2b-saas-starter\/auth(?:\/|$)/,
      /^@b2b-saas-starter\/db\/(?!ids$|enums$)/,
      /^drizzle-orm(?:\/|$)/,
      /^effectful-better-auth(?:\/|$)/,
      /^better-auth$/,
      /^better-auth\/(?:api|adapters)(?:\/|$)/
    ],
    files: [
      '**/*.server.*',
      '**/*.effects.ts',
      '**/packages/auth/src/**',
      /\/packages\/db\/src\/(?!ids\.ts$|enums\.ts$)/,
      // workspace-identity.seed is the established data-only demo identity,
      // not a Seed adapter. Its imports still undergo graph checking.
      /\/packages\/capabilities\/src\/(?!governance\/workspace-identity\.seed\.ts$).*\.(?:live|seed)\.ts$/,
      /\/packages\/capabilities\/src\/(?:runtime|layers|workspace-context|workspace-projections|billing-adapters|crypto)\.ts$/,
      /\/packages\/capabilities\/src\/assistant\/(?:runtime|lifecycle)\.ts$/,
      /\/packages\/capabilities\/src\/developer-platform\/assistant-conversation-(?:execution|admission|transport)\.ts$/,
      ...[
        'account-preferences',
        'audited-mutation',
        'invitation-email-history',
        'operational-health',
        'retention-policy',
        'security-recovery-evidence',
        'strong-authentication',
        'turnstile-verification',
        'workspace-invitations',
        'workspace-lifecycle',
        'workspace-membership',
        'workspace-onboarding',
        'workspace-suspension.internal',
        'workspace-export-archive',
        'workspace-export-generation',
        'workspace-export-snapshot'
      ].map((name) => `**/packages/capabilities/src/governance/${name}.ts`),
      ...[
        'api-token-policy',
        'assistant-authority',
        'assistant-conversations',
        'assistant-conversation-events',
        'assistant-conversation-observability',
        'assistant-conversation-transcript',
        'assistant-task-evidence',
        'webhook-attempt-completion',
        'webhook-investigation-tasks',
        'webhook-publisher',
        'webhook-replay'
      ].map((name) => `**/packages/capabilities/src/developer-platform/${name}.ts`),
      /\/packages\/capabilities\/src\/internal\/(?:ids|queue-publisher|best-effort)\.ts$/,
      /\/packages\/capabilities\/src\/notifications\/(?:notification-fan-out|notification-preferences|notification-email-eligibility)\.ts$/,
      /\/packages\/billing\/src\/.*\.(?:live|seed)\.ts$/,
      /\/packages\/billing\/src\/(?:stripe|billing-config|billing-lease|billing-sync-store|seat-sync)\.ts$/,
      /\/packages\/email-delivery\/src\/.*\.(?:live|seed)\.ts$/,
      '**/packages/email-delivery/src/email-delivery.internal.ts',
      '**/packages/email/src/**',
      '**/packages/env/src/server.ts',
      /\/packages\/authz\/src\/(?:guard|assistant-access-token|mcp-access-token)\.ts$/,
      /\/apps\/web\/src\/lib\/(?:auth-runtime|capabilities|observability|request-context|local-d1-state|cloudflare-workers-shim)\.ts$/
    ]
  }
}
