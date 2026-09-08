import { Schema } from 'effect'

/** The current plan refuses a resource operation at its entitlement ceiling. */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory, not an Error constructor
export class PlanLimitExceeded extends Schema.TaggedError<PlanLimitExceeded>()(
  'PlanLimitExceeded',
  {
    planId: Schema.String,
    resource: Schema.String,
    limit: Schema.Number
  },
  { httpApiStatus: 402 }
) {}

/** Submitted selection ids are unknown, foreign, or no longer eligible. */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory, not an Error constructor
export class ResourceSelectionRejected extends Schema.TaggedError<ResourceSelectionRejected>()(
  'ResourceSelectionRejected',
  {
    resource: Schema.String,
    reason: Schema.String
  },
  { httpApiStatus: 400 }
) {}
