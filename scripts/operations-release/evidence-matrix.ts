export type OperationsEvidenceSeam =
  | 'effect-contract'
  | 'd1-integration'
  | 'http-boundary'
  | 'browser-boundary'
  | 'configuration-boundary'
  | 'notification-capture'
  | 'repository-boundary'

export type OperationsEvidenceReference = {
  readonly workspace: string
  readonly testFile: string
}

export type OperationsSecurityControl = {
  readonly id: string
  readonly title: string
  readonly claims: readonly string[]
  readonly seams: readonly OperationsEvidenceSeam[]
  readonly evidence: readonly OperationsEvidenceReference[]
}

const evidence = (
  workspace: string,
  ...testFiles: readonly string[]
): readonly OperationsEvidenceReference[] =>
  testFiles.map((testFile) => ({ workspace, testFile }))

export const operationsSecurityEvidenceMatrix = [
  {
    id: 'OPS-AUD-01',
    title: 'Global Operations evidence is complete, durable, and protected',
    claims: [
      'audit:start-attempt',
      'audit:handoff',
      'audit:activation',
      'audit:stop',
      'audit:expiry',
      'audit:revocation',
      'audit:rejection',
      'audit:sensitive-read',
      'audit:mutation-accepted',
      'audit:mutation-rejected',
      'retention:stable-identifiers-two-years',
      'retention:survives-identity-deletion',
      'privacy:reason-and-reference-protected'
    ],
    seams: ['effect-contract', 'd1-integration', 'browser-boundary'],
    evidence: [
      ...evidence(
        'packages/capabilities',
        'src/governance/operations-audit.live.test.ts',
        'src/governance/operations-discovery.live.test.ts',
        'src/governance/operations-impersonation.live.test.ts',
        'src/governance/operations-impersonation-authority.live.test.ts',
        'src/governance/operations-impersonation-lifecycle.live.test.ts'
      ),
      ...evidence('apps/operations', 'src/tanstack-routes.browser.test.tsx')
    ]
  },
  {
    id: 'OPS-RATE-01',
    title: 'Every Operations abuse surface has an isolated limit',
    claims: [
      'rate-limit:session-read',
      'rate-limit:authentication',
      'rate-limit:totp',
      'rate-limit:search',
      'rate-limit:management',
      'rate-limit:impersonation-start',
      'rate-limit:handoff-exchange'
    ],
    seams: ['effect-contract', 'd1-integration', 'http-boundary'],
    evidence: [
      ...evidence(
        'packages/capabilities',
        'src/governance/operations-rate-limit.test.ts'
      ),
      ...evidence(
        'apps/operations',
        'src/abuse-protection.test.ts',
        'src/config.test.ts',
        'src/worker.rate-limit.test.ts'
      ),
      ...evidence('apps/merchant', 'src/lib/impersonation-handoff.integration.test.ts')
    ]
  },
  {
    id: 'OPS-NOTIFY-01',
    title: 'Lifecycle notifications are atomic, sanitized, and recoverable',
    claims: [
      'notification:start',
      'notification:stop',
      'notification:expiry',
      'notification:revocation',
      'notification:atomic-intent',
      'notification:asynchronous-retry',
      'notification:idempotent-delivery',
      'notification:deterministic-local-capture',
      'notification:sanitized-content'
    ],
    seams: ['effect-contract', 'd1-integration', 'notification-capture'],
    evidence: [
      ...evidence(
        'packages/capabilities',
        'src/governance/operations-impersonation.live.test.ts',
        'src/governance/operations-impersonation-lifecycle.live.test.ts'
      ),
      ...evidence('apps/background', 'src/operations-notifications.integration.test.ts')
    ]
  },
  {
    id: 'OPS-ISO-01',
    title: 'Operations and Merchant authentication stay isolated in the browser',
    claims: [
      'isolation:cookie',
      'isolation:secret',
      'isolation:base-url',
      'isolation:trusted-origin',
      'isolation:top-level-post',
      'isolation:normal-session-rejection'
    ],
    seams: ['d1-integration', 'http-boundary', 'browser-boundary'],
    evidence: [
      ...evidence(
        'packages/auth',
        'src/isolated-impersonation-handoff.integration.test.ts'
      ),
      ...evidence(
        'apps/operations',
        'src/config.test.ts',
        'src/local-runtime.integration.test.ts',
        'src/tanstack-routes.browser.test.tsx'
      ),
      ...evidence('apps/merchant', 'src/lib/impersonation-handoff.integration.test.ts')
    ]
  },
  {
    id: 'OPS-AUTHZ-01',
    title: 'Only the four composable roles grant Operations authority',
    claims: [
      'authorization:merchant-reader',
      'authorization:merchant-impersonator',
      'authorization:impersonation-auditor',
      'authorization:operator-manager',
      'authorization:stock-admin-endpoints-denied'
    ],
    seams: ['effect-contract', 'd1-integration', 'browser-boundary'],
    evidence: [
      ...evidence('packages/auth', 'src/operations.integration.test.ts'),
      ...evidence(
        'packages/capabilities',
        'src/governance/operations-management.integration.test.ts'
      ),
      ...evidence('apps/operations', 'src/tanstack-routes.browser.test.tsx')
    ]
  },
  {
    id: 'OPS-OPERATOR-01',
    title: 'Operator identity, enrollment, sessions, and recovery fail closed',
    claims: [
      'identity:disjoint-classes',
      'operator:invitation-and-enrollment',
      'operator:single-session',
      'operator:absolute-session-limit',
      'operator:idle-session-limit',
      'operator:recovery'
    ],
    seams: ['effect-contract', 'd1-integration', 'browser-boundary'],
    evidence: [
      ...evidence('packages/auth', 'src/operations.integration.test.ts'),
      ...evidence(
        'packages/capabilities',
        'src/governance/operator-invitations.integration.test.ts',
        'src/governance/system-operator-maintenance.live.test.ts'
      ),
      ...evidence(
        'apps/operations',
        'src/local-runtime.integration.test.ts',
        'src/tanstack-routes.browser.test.tsx'
      ),
      ...evidence('scripts', 'system-operator-maintenance.test.ts')
    ]
  },
  {
    id: 'OPS-IMPERSONATE-01',
    title: 'Impersonation concurrency and effective authority are bounded',
    claims: [
      'impersonation:operator-concurrency',
      'impersonation:target-concurrency',
      'impersonation:reduced-authority-intersection',
      'impersonation:denied-action-categories',
      'impersonation:allowed-reversible-actions',
      'impersonation:immediate-revocation'
    ],
    seams: ['effect-contract', 'd1-integration', 'http-boundary'],
    evidence: [
      ...evidence(
        'packages/capabilities',
        'src/governance/operations-impersonation.live.test.ts',
        'src/governance/operations-impersonation-authority.live.test.ts',
        'src/governance/operations-impersonation-lifecycle.live.test.ts',
        'src/governance/operations-management.integration.test.ts'
      ),
      ...evidence(
        'apps/merchant',
        'src/lib/merchant-auth-handler.test.ts',
        'src/lib/server/merchant-request-authority.test.ts'
      )
    ]
  },
  {
    id: 'OPS-BROWSER-01',
    title: 'The complete support journey is proven at browser boundaries',
    claims: [
      'browser:search-to-target',
      'browser:fresh-totp',
      'browser:post-handoff',
      'browser:persistent-banner',
      'browser:allowed-action',
      'browser:denied-action',
      'browser:normal-session-rejection',
      'browser:stop',
      'browser:expiry',
      'browser:revocation',
      'browser:return-to-operations'
    ],
    seams: ['http-boundary', 'browser-boundary', 'd1-integration'],
    evidence: [
      ...evidence(
        'apps/operations',
        'src/tanstack-runtime.browser.test.ts',
        'src/tanstack-routes.browser.test.tsx',
        'src/local-runtime.integration.test.ts',
        'src/worker.discovery.test.ts'
      ),
      ...evidence(
        'packages/auth',
        'src/isolated-impersonation-handoff.integration.test.ts'
      ),
      ...evidence(
        'apps/merchant',
        'src/impersonation-lifecycle.browser.test.ts',
        'src/components/impersonation-banner.browser.test.tsx',
        'src/lib/merchant-auth-handler.test.ts',
        'src/lib/server/merchant-request-authority.test.ts'
      )
    ]
  },
  {
    id: 'OPS-PROD-01',
    title: 'Production readiness requires application-owned security controls',
    claims: [
      'production:missing-secret-fails-closed',
      'production:missing-email-fails-closed',
      'production:cloudflare-access-deferred'
    ],
    seams: ['configuration-boundary', 'http-boundary'],
    evidence: evidence(
      'apps/operations',
      'src/config.test.ts',
      'src/worker.readiness.test.ts'
    )
  },
  {
    id: 'OPS-CUTOVER-01',
    title: 'Operations is the only supported platform-administration model',
    claims: [
      'cutover:legacy-auth-removed',
      'cutover:public-admin-docs-removed',
      'cutover:six-worker-runtime-documented',
      'cutover:operator-procedures-documented'
    ],
    seams: ['repository-boundary'],
    evidence: evidence('scripts', 'operations-cutover.test.ts')
  }
] as const satisfies readonly OperationsSecurityControl[]

export const operationsReleaseEvidence = [
  ...new Map(
    [
      {
        workspace: 'scripts',
        testFile: 'operations-release/evidence-matrix.test.ts'
      },
      ...operationsSecurityEvidenceMatrix.flatMap((control) => control.evidence),
      {
        workspace: 'scripts',
        testFile: 'operations-release/run.test.ts'
      }
    ].map((reference) => [`${reference.workspace}/${reference.testFile}`, reference])
  ).values()
]
