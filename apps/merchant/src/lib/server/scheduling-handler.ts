import { Effect } from 'effect'
import {
  BookingPublication,
  MerchantCatalog,
  MerchantContext,
  Scheduling,
  type ScheduleRule,
  type ScheduleRuleInput
} from '@b2b-saas-starter/capabilities'

type Services = BookingPublication | MerchantCatalog | MerchantContext | Scheduling
export type SchedulingRunner = <A, E>(
  userId: string,
  effect: Effect.Effect<A, E, Services>
) => Promise<A>

export const makeSchedulingRequestHandler = (dependencies: {
  readonly currentUserId: () => Promise<string>
  readonly run: SchedulingRunner
  readonly now: () => string
}) => ({
  read: async () => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.gen(function* () {
        const catalog = yield* MerchantCatalog
        const scheduling = yield* Scheduling
        const publication = yield* BookingPublication
        const merchant = yield* MerchantContext
        const snapshot = yield* catalog.read()
        const rules = yield* Effect.forEach(snapshot.providers, (provider) =>
          scheduling.listProviderRules(provider.id)
        )
        const firstBookable = snapshot.services.find(
          (service) =>
            service.status === 'active' && service.eligibleProviderIds.length > 0
        )
        const availability = firstBookable
          ? yield* scheduling.availability({
              providerId: firstBookable.eligibleProviderIds[0]!,
              serviceId: firstBookable.id,
              from: dependencies.now(),
              days: 14
            })
          : null
        return {
          snapshot,
          merchant,
          rules: Object.fromEntries(
            snapshot.providers.map((provider, index) => [
              provider.id,
              rules[index] ?? []
            ])
          ) as Readonly<Record<string, readonly ScheduleRule[]>>,
          availability,
          publication: yield* publication.current()
        }
      })
    )
  },
  saveRules: async (input: {
    readonly providerId: string
    readonly rules: readonly ScheduleRuleInput[]
  }) => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.flatMap(Scheduling, (scheduling) =>
        scheduling.saveProviderRules(input.providerId, input.rules)
      )
    )
  },
  setPublished: async (published: boolean) => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.gen(function* () {
        const publication = yield* BookingPublication
        if (published) return yield* publication.publish()
        return yield* publication.unpublish()
      })
    )
  }
})
