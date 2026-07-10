import { Effect } from 'effect'
import {
  BookingPublication,
  type CapabilityUnavailable,
  type PublicBookingPage
} from '@b2b-saas-starter/capabilities'

export type PublicPageResolution =
  | { readonly kind: 'published'; readonly page: PublicBookingPage }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'unpublished' }

export const resolvePublicBookingPage = (
  slug: string
): Effect.Effect<PublicPageResolution, CapabilityUnavailable, BookingPublication> =>
  Effect.flatMap(BookingPublication, (publication) =>
    publication.resolvePublished(slug)
  ).pipe(
    Effect.map((page) => ({ kind: 'published' as const, page })),
    Effect.catchTag('PublicBookingPageNotFound', (error) =>
      Effect.succeed({ kind: error.reason } as const)
    )
  )
