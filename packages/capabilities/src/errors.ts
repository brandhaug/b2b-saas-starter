import { Schema } from 'effect'

export class WorkspaceNotFound extends Schema.TaggedError<WorkspaceNotFound>()(
  'WorkspaceNotFound',
  { slug: Schema.String },
  { httpApiStatus: 404 }
) {}

export class CapabilityUnavailable extends Schema.TaggedError<CapabilityUnavailable>()(
  'CapabilityUnavailable',
  { capability: Schema.String, reason: Schema.String },
  { httpApiStatus: 503 }
) {}

export class AuthorizationDenied extends Schema.TaggedError<AuthorizationDenied>()(
  'AuthorizationDenied',
  { reason: Schema.String },
  { httpApiStatus: 403 }
) {}
