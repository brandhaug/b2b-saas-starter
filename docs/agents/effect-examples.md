# Effect examples

Resolve Effect's version from `pnpm-workspace.yaml` and inspect the installed
source. Choose the closest example, then read its intent node:

| Work                                    | Example                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service contract and Seed/Live adapters | [audit-event-log.ts](../../packages/capabilities/src/governance/audit-event-log.ts) and its [intent node](../../packages/capabilities/src/governance/audit-event-log.AGENTS.md)                   |
| Shared adapter tests                    | [audit-event-log.contract.ts](../../packages/capabilities/src/governance/audit-event-log.contract.ts) and [Live harness](../../packages/capabilities/src/governance/audit-event-log.live.test.ts) |
| Runtime composition                     | [runtime.ts](../../packages/capabilities/src/runtime.ts) and [layers.ts](../../packages/capabilities/src/layers.ts)                                                                               |
| Permission checks at callers            | [request-guards.ts](../../apps/api/src/request-guards.ts) and [handlers.ts](../../apps/api/src/handlers.ts)                                                                                       |
| Mutation/audit atomicity                | [audited-mutation.ts](../../packages/capabilities/src/governance/audited-mutation.ts)                                                                                                             |

The [capabilities intent node](../../packages/capabilities/AGENTS.md) owns the
exceptions to generic Effect advice: typed invocation bindings for provider
selection, caller-side permissions, plugin-backed audit divergence, and D1 batch
atomicity. Consult those rules before proposing a service or Layer redesign.
