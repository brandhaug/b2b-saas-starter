import { describe } from 'vite-plus/test'
import { lintConfig } from '../../../lint.config.ts'
import { createRuleHarness } from './harness.ts'

// Failure modes: glob/order changes exempt services, exclude new files, or
// reject legitimate browser, auth, SDK, CLI and test/setup execution boundaries.
describe('root runtime boundary policy', () => {
  for (const rule of ['effect/noRunPromise', 'starter/no-runtime-execution']) {
    const overrides = (lintConfig.overrides ?? []).flatMap((override) => {
      const severity = override.rules?.[rule]
      if (severity !== 'off' && severity !== 'error') {
        return []
      }
      return [{ files: override.files, rules: { [rule]: severity } }]
    })
    const { valid, invalid } = createRuleHarness(rule, {}, overrides)
    let call = `import { ManagedRuntime } from 'effect'; ManagedRuntime.make(layer)`
    if (rule === 'effect/noRunPromise') {
      call = `import { Effect } from 'effect'; Effect.runPromise(program)`
    }

    for (const filename of [
      'packages/capabilities/src/governance/new-service.ts',
      'packages/db/src/new-repository.ts',
      'packages/billing/src/service.ts',
      'apps/web/src/lib/new-feature-runtime.ts',
      'apps/api/src/new-service.ts'
    ]) {
      invalid(`${rule} rejects ${filename}`, call, undefined, { filename })
    }
    for (const filename of [
      'apps/web/src/lib/auth-runtime.ts',
      'apps/web/src/lib/observability.ts',
      'apps/web/src/lib/assistant/conversation-host.ts',
      'apps/background/src/queue-consumer.ts',
      'apps/web/src/hooks/use-assistant-conversation.ts',
      'apps/web/src/components/auth/auth-request.ts',
      'packages/capabilities/src/index.test.ts',
      'packages/capabilities/src/testing/live-harness.ts',
      'packages/db/src/testing.ts',
      'packages/ai/src/test-ask.ts',
      'scripts/operator.ts',
      'infra/deployment-origins.ts'
    ]) {
      valid(`${rule} allows ${filename}`, call, { filename })
    }
  }

  const rule = 'starter/no-run-promise-in-tests'
  const overrides = (lintConfig.overrides ?? []).flatMap((override) => {
    const severity = override.rules?.[rule]
    if (severity !== 'off' && severity !== 'error') {
      return []
    }
    return [{ files: override.files, rules: { [rule]: severity } }]
  })
  const { valid, invalid } = createRuleHarness(rule, {}, overrides)
  const call = `import { Effect } from 'effect'; Effect.runPromise(program)`
  for (const filename of [
    'packages/capabilities/src/operation.test.ts',
    'packages/capabilities/src/operation.spec.ts',
    'apps/web/src/component.spec.tsx'
  ]) {
    invalid(
      `requires test-runner interop justification in ${filename}`,
      call,
      undefined,
      { filename }
    )
    valid(
      `allows justified interop in ${filename}`,
      `import { Effect } from 'effect';\n// oxlint-disable-next-line starter/no-run-promise-in-tests -- native callback port under test owns execution\nEffect.runPromise(program)`,
      { filename }
    )
  }
  for (const filename of [
    'apps/web/e2e/audit-inspection.spec.ts',
    'packages/capabilities/src/testing/live-harness.ts',
    'packages/db/src/testing.ts'
  ]) {
    valid(`allows explicit external runner adapter ${filename}`, call, { filename })
  }
})
