import { Effect } from 'effect'
import {
  MerchantCatalog,
  MerchantContext
} from '@b2b-saas-starter/capabilities/merchant-catalog'
import {
  BookingPublication,
  MerchantActivation,
  Scheduling,
  type ActivationConfirmationInput,
  type BlockedTimeInput,
  type BusinessDetailsInput,
  type DateOverrideInput,
  type LaunchTestInput,
  type ScheduleRule,
  type ScheduleRuleInput
} from '@b2b-saas-starter/capabilities/scheduling'

type Services =
  | BookingPublication
  | MerchantActivation
  | MerchantCatalog
  | MerchantContext
  | Scheduling
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
        const activation = yield* MerchantActivation
        const merchant = yield* MerchantContext
        const snapshot = yield* catalog.read()
        const rules = yield* Effect.forEach(snapshot.providers, (provider) =>
          scheduling.listProviderRules(provider.id)
        )
        const availability = yield* scheduling.previewAvailability({
          from: dependencies.now(),
          days: 14
        })
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
          controls: yield* scheduling.listControls(),
          activation: yield* activation.read(),
          publication: yield* publication.current()
        }
      })
    )
  },
  availability: async (input: {
    readonly providerId: string
    readonly serviceId: string
    readonly from: string
    readonly days?: number
    readonly durationMinutes?: number
  }) => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.flatMap(Scheduling, (scheduling) => scheduling.availability(input))
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
  previewRulesImpact: async (input: {
    readonly providerId: string
    readonly rules: readonly ScheduleRuleInput[]
  }) => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.flatMap(Scheduling, (scheduling) =>
        scheduling.previewProviderRulesImpact(input.providerId, input.rules)
      )
    )
  },
  saveActivation: async (input: ActivationConfirmationInput) => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.flatMap(MerchantActivation, (activation) =>
        activation.saveConfirmations(input)
      )
    )
  },
  saveBusinessDetails: async (input: BusinessDetailsInput) => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.flatMap(MerchantActivation, (activation) =>
        activation.saveBusinessDetails(input)
      )
    )
  },
  runLaunchTest: async (input: LaunchTestInput) => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.flatMap(MerchantActivation, (activation) =>
        activation.runLaunchTest(input)
      )
    )
  },
  saveDateOverride: async (input: DateOverrideInput) => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.flatMap(Scheduling, (scheduling) => scheduling.saveDateOverride(input))
    )
  },
  previewDateOverrideImpact: async (input: DateOverrideInput) => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.flatMap(Scheduling, (scheduling) =>
        scheduling.previewDateOverrideImpact(input)
      )
    )
  },
  addBlockedTime: async (input: BlockedTimeInput) => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.flatMap(Scheduling, (scheduling) => scheduling.addBlockedTime(input))
    )
  },
  previewBlockedTimeImpact: async (input: BlockedTimeInput) => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.flatMap(Scheduling, (scheduling) =>
        scheduling.previewBlockedTimeImpact(input)
      )
    )
  },
  previewTimezoneImpact: async (timezone: string) => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.flatMap(Scheduling, (scheduling) =>
        scheduling.previewTimezoneImpact(timezone)
      )
    )
  },
  changeTimezone: async (input: { timezone: string; confirmed: boolean }) => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.flatMap(Scheduling, (scheduling) => scheduling.changeTimezone(input))
    )
  },
  setPublished: async (published: boolean) => {
    const userId = await dependencies.currentUserId()
    return dependencies.run(
      userId,
      Effect.gen(function* () {
        const publication = yield* BookingPublication
        if (published) {
          const activation = yield* MerchantActivation
          return yield* activation.publish()
        }
        return yield* publication.unpublish()
      })
    )
  }
})
