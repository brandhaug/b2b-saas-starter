// Declaration merging lives in `.d.ts` files. `consistent-type-definitions` is
// context-blind: it rewrites `interface` to `type` inside `declare module` blocks
// too, which turns an augmentation into a duplicate identifier. `.oxlintrc.json`
// exempts `**/*.d.ts`, so keeping merges here needs no disable comments.
//
// The top-level import is load-bearing: it makes this file a module, which is what
// makes the block below augment `@tanstack/react-router` instead of replacing it.
import type { getRouter } from './router'

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
