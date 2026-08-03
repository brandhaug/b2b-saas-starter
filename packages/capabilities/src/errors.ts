import { Schema } from 'effect'

export class CapabilityUnavailable extends Schema.TaggedErrorClass<CapabilityUnavailable>()(
  'CapabilityUnavailable',
  { capability: Schema.String, reason: Schema.String },
  { httpApiStatus: 503 }
) {}

export class CapabilityNotFound extends Schema.TaggedErrorClass<CapabilityNotFound>()(
  'CapabilityNotFound',
  { resource: Schema.String },
  { httpApiStatus: 404 }
) {}

export class CapabilityDenied extends Schema.TaggedErrorClass<CapabilityDenied>()(
  'CapabilityDenied',
  { reason: Schema.String },
  { httpApiStatus: 403 }
) {}

export class CapabilityConflict extends Schema.TaggedErrorClass<CapabilityConflict>()(
  'CapabilityConflict',
  {
    reason: Schema.String,
    currentRevision: Schema.optional(Schema.Number),
    current: Schema.optional(Schema.Unknown)
  },
  { httpApiStatus: 409 }
) {}
