// The social sign-in provider ids, in their own dependency-free module: the
// browser bundle imports this too (`auth-client-ports` derives its port type
// from the same closed set), and it must not drag `effect` in — statically
// imported auth routes pin whatever their imports pin. `./server` re-exports
// both, so server callers keep one import path.

/** The social sign-in providers the starter knows how to wire. */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const SOCIAL_PROVIDER_IDS = ['github', 'google'] as const

export type SocialProviderId = (typeof SOCIAL_PROVIDER_IDS)[number]
