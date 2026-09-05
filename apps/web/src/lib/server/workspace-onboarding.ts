import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

/**
 * The onboarding-dismissal server function, in a **client-safe** module —
 * the `invitations.ts` pattern, and the client-safe half of the
 * `workspace-onboarding.effects.ts` split; see apps/web/AGENTS.md for the
 * rule and `scripts/assert-client-boundary.mjs` for the enforcement. Each
 * input is written once, as its Effect Schema: the validator is the single
 * strict decode, and the derived type types both the client stub and the
 * effects handler.
 */

const DismissInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

export type DismissInput = typeof DismissInput.Type

export const dismissOnboardingChecklistServerFn = createServerFn({
  method: 'POST'
})
  .validator(Schema.decodeUnknownSync(DismissInput))
  .handler(async ({ data }): Promise<boolean> => {
    const { dismissOnboardingChecklistHandler } =
      await import('./workspace-onboarding.effects')
    return dismissOnboardingChecklistHandler(data)
  })
