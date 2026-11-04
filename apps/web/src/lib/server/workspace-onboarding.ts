import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

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
