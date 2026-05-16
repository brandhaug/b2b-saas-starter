import { Schema } from 'effect'

export class WorkspaceNotFound extends Schema.TaggedErrorClass<WorkspaceNotFound>()(
  'WorkspaceNotFound',
  { slug: Schema.String },
  { httpApiStatus: 404 }
) {}

export class CapabilityUnavailable extends Schema.TaggedErrorClass<CapabilityUnavailable>()(
  'CapabilityUnavailable',
  { capability: Schema.String, reason: Schema.String },
  { httpApiStatus: 503 }
) {}

export class AuthorizationDenied extends Schema.TaggedErrorClass<AuthorizationDenied>()(
  'AuthorizationDenied',
  { reason: Schema.String },
  { httpApiStatus: 403 }
) {}
