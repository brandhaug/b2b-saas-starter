import { Schema } from 'effect'

export class CapabilityUnavailable extends Schema.TaggedErrorClass<CapabilityUnavailable>()(
  'CapabilityUnavailable',
  { capability: Schema.String, reason: Schema.String },
  { httpApiStatus: 503 }
) {}
