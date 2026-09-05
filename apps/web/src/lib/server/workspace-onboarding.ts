import { createServerFn } from '@tanstack/react-start'

import { expectRecord, expectString } from './input-shape'

/**
 * The onboarding-dismissal server function, in a **client-safe** module —
 * the `invitations.ts` pattern. This file is statically imported by the
 * dashboard's checklist card, and the route tree ships to the browser — so
 * everything at this module's top level rides on every page. That is why the
 * effect and its imports (the capability service, the permission gate, the
 * session gate) live in `workspace-onboarding.effects.ts` and are reached
 * only through dynamic `import()` inside the handler: TanStack Start strips
 * handler bodies from the client build, so the effects graph never ships.
 * The validator is stripped the same way — `.validator()` runs on the server
 * only — so the plain shape check below is the server's first decode, while
 * the strict schema decodes again in the effects file.
 */

type DismissInput = {
  readonly workspaceSlug: string
}

/**
 * The server fn's validator, a plain shape check that runs on the server only
 * (TanStack strips `.validator()` from the client build): it is the server's
 * first decode, and the strict schema decodes again in
 * `workspace-onboarding.effects.ts`.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the server fn hands the handler untyped `data`; the strict schema decode is this function's first act
function decodeDismissInput(input: unknown): DismissInput {
  const record = expectRecord(input, 'dismiss input')
  return { workspaceSlug: expectString(record, 'workspaceSlug', 'dismiss input') }
}

export const dismissOnboardingChecklistServerFn = createServerFn({
  method: 'POST'
})
  .validator(decodeDismissInput)
  .handler(async ({ data }): Promise<boolean> => {
    const { dismissOnboardingChecklistHandler } =
      await import('./workspace-onboarding.effects')
    return dismissOnboardingChecklistHandler(data)
  })
