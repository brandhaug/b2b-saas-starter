import { Schema } from 'effect'
import { AuditEventRecords } from './administration-records'

export const AuditEventMetadata = Schema.Struct({
  attempts: Schema.optionalKey(Schema.Number),
  role: Schema.optionalKey(
    Schema.Union([
      Schema.Literal('owner'),
      Schema.Literal('admin'),
      Schema.Literal('member')
    ])
  ),
  protocol: Schema.optionalKey(
    Schema.Union([Schema.Literal('saml'), Schema.Literal('oidc')])
  ),
  responseStatus: Schema.optionalKey(Schema.Union([Schema.Null, Schema.Number])),
  sizeBytes: Schema.optionalKey(Schema.Number)
})

export const AuditEventDetail = Schema.Struct({
  id: Schema.String,
  eventType: Schema.String,
  targetType: Schema.String,
  targetId: Schema.Union([Schema.Null, Schema.String]),
  actor: Schema.String,
  actorType: Schema.String,
  createdAt: Schema.String,
  actorUserId: Schema.Union([Schema.Null, Schema.String]),
  metadata: AuditEventMetadata
})

export const OptionalAuditEventDetail = Schema.Union([Schema.Null, AuditEventDetail])

export const AuditSearchFilters = Schema.Struct({
  eventType: Schema.optionalKey(Schema.String),
  actorUserId: Schema.optionalKey(Schema.String),
  since: Schema.optionalKey(Schema.String),
  until: Schema.optionalKey(Schema.String)
})

export const TextFilterOperator = Schema.Union([
  Schema.Literal('gt'),
  Schema.Literal('lt'),
  Schema.Literal('contains'),
  Schema.Literal('notContains'),
  Schema.Literal('is'),
  Schema.Literal('isNot'),
  Schema.Literal('before'),
  Schema.Literal('after'),
  Schema.Literal('isEmpty'),
  Schema.Literal('isNotEmpty')
])

export const AuditTextFilter = Schema.Struct({
  field: Schema.Union([
    Schema.Literal('eventType'),
    Schema.Literal('actorType'),
    Schema.Literal('actorUserId')
  ]),
  operator: TextFilterOperator,
  value: Schema.String
})

export const DateFilterOperator = Schema.Union([
  Schema.Literal('gt'),
  Schema.Literal('lt'),
  Schema.Literal('is'),
  Schema.Literal('isNot'),
  Schema.Literal('before'),
  Schema.Literal('after'),
  Schema.Literal('isEmpty'),
  Schema.Literal('isNotEmpty')
])

export const AuditDateFilter = Schema.Struct({
  field: Schema.Literal('createdAt'),
  operator: DateFilterOperator,
  value: Schema.String
})

export const AuditFilter = Schema.Union([AuditTextFilter, AuditDateFilter])

export const AuditFilters = Schema.Array(AuditFilter)

export const AuditSort = Schema.Struct({
  field: Schema.Union([
    Schema.Literal('eventType'),
    Schema.Literal('createdAt'),
    Schema.Literal('actorType'),
    Schema.Literal('actorUserId')
  ]),
  direction: Schema.Union([Schema.Literal('asc'), Schema.Literal('desc')])
})

export const AuditSorts = Schema.Array(AuditSort)

export const AuditTableView = Schema.Struct({
  match: Schema.Union([Schema.Literal('all'), Schema.Literal('any')]),
  filters: AuditFilters,
  sorts: AuditSorts
})

export const OptionalAuditTableView = Schema.optionalKey(AuditTableView)

export const LoadWorkspaceAuditEventsSchema = Schema.Struct({
  selectedEvent: OptionalAuditEventDetail,
  viewer: Schema.Union([
    Schema.Null,
    Schema.Struct({
      role: Schema.Union([
        Schema.Literal('owner'),
        Schema.Literal('admin'),
        Schema.Literal('member')
      ])
    })
  ]),
  events: AuditEventRecords,
  nextCursor: Schema.Union([Schema.Null, Schema.String]),
  filters: AuditSearchFilters,
  view: OptionalAuditTableView,
  members: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String }))
})
