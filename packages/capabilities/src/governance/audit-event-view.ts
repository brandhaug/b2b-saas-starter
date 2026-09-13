import { Encoding, Option, Result, Schema } from 'effect'

export const AuditViewField = Schema.Literals([
  'eventType',
  'actorUserId',
  'actorType',
  'createdAt'
])
export const AuditViewOperator = Schema.Literals([
  'contains',
  'notContains',
  'is',
  'isNot',
  'before',
  'after',
  'gt',
  'lt',
  'isEmpty',
  'isNotEmpty'
])
const AuditFilter = Schema.Union([
  Schema.Struct({
    field: Schema.Literals(['eventType', 'actorUserId', 'actorType']),
    operator: AuditViewOperator,
    value: Schema.String.check(Schema.isMaxLength(512))
  }),
  Schema.Struct({
    field: Schema.Literal('createdAt'),
    operator: Schema.Literals([
      'is',
      'isNot',
      'before',
      'after',
      'gt',
      'lt',
      'isEmpty',
      'isNotEmpty'
    ]),
    value: Schema.String.check(Schema.isMaxLength(128))
  })
])
export const AuditView = Schema.Struct({
  match: Schema.Literals(['all', 'any']),
  filters: Schema.Array(AuditFilter).check(Schema.isMaxLength(12)),
  sorts: Schema.Array(
    Schema.Struct({
      field: AuditViewField,
      direction: Schema.Literals(['asc', 'desc'])
    })
  ).check(Schema.isMaxLength(4))
})
export type AuditViewFilter = typeof AuditFilter.Type
export type AuditViewSort = (typeof AuditView.Type.sorts)[number]
export type AuditView = typeof AuditView.Type
export const defaultAuditView: AuditView = {
  match: 'all',
  filters: [],
  sorts: [{ field: 'createdAt', direction: 'desc' }]
}
export type AuditViewRow = {
  readonly id: string
  readonly eventType: string
  readonly actorUserId?: string | null
  readonly actorType: string
  readonly createdAt: string
}
export type AuditCursor = {
  readonly view: string
  readonly values: ReadonlyArray<string>
  readonly id: string
}
const AuditCursorSchema = Schema.Struct({
  view: Schema.String,
  values: Schema.Array(Schema.String),
  id: Schema.String
})
const QueryContext = Schema.Struct({
  view: AuditView,
  workspaceId: Schema.optional(Schema.String),
  actorUserId: Schema.optional(Schema.String),
  eventType: Schema.optional(Schema.String),
  since: Schema.optional(Schema.String),
  until: Schema.optional(Schema.String)
})
const encodeContext = Schema.encodeSync(Schema.fromJsonString(QueryContext))
const encodeCursor = Schema.encodeSync(Schema.fromJsonString(AuditCursorSchema))
const decodeCursor = Schema.decodeUnknownOption(
  Schema.fromJsonString(AuditCursorSchema)
)
export function auditViewKey(
  view: AuditView,
  workspaceId?: string,
  input?: {
    readonly actorUserId?: string | undefined
    readonly eventType?: string | undefined
    readonly since?: string | undefined
    readonly until?: string | undefined
  }
): string {
  return encodeContext({
    view,
    workspaceId,
    actorUserId: input?.actorUserId,
    eventType: input?.eventType,
    since: input?.since,
    until: input?.until
  })
}
export function normalizeAuditView(view: AuditView | undefined): AuditView {
  if (!view) {
    return defaultAuditView
  }
  const filters = view.filters.filter(
    (filter) =>
      filter.value.trim().length > 0 ||
      filter.operator === 'isEmpty' ||
      filter.operator === 'isNotEmpty'
  )
  if (view.sorts.length === 0) {
    return { match: view.match, filters, sorts: defaultAuditView.sorts }
  }
  return { match: view.match, filters, sorts: view.sorts }
}
export function encodeAuditCursor(cursor: AuditCursor): string {
  return Encoding.encodeBase64(encodeCursor(cursor))
}
export function decodeAuditCursor(
  cursor: string | undefined,
  key: string,
  sortCount: number
): AuditCursor | null | undefined {
  if (cursor === undefined) {
    return
  }
  const decoded = Encoding.decodeBase64String(cursor)
  if (Result.isFailure(decoded)) {
    return null
  }
  const candidate = decodeCursor(decoded.success)
  if (
    Option.isNone(candidate) ||
    candidate.value.view !== key ||
    candidate.value.values.length !== sortCount
  ) {
    return null
  }
  return candidate.value
}
export function auditSortValue(
  row: AuditViewRow,
  field: AuditViewSort['field']
): string {
  const value = row[field]
  return value ?? ''
}
function compareValues(
  a: string,
  b: string,
  direction: 'asc' | 'desc' | undefined
): number {
  if (a === b) {
    return 0
  }
  if (direction === 'asc') {
    if (a < b) {
      return -1
    }
    return 1
  }
  if (a < b) {
    return 1
  }
  return -1
}
export function compareAuditRows(
  a: AuditViewRow,
  b: AuditViewRow,
  view: AuditView
): number {
  for (const sort of view.sorts) {
    const comparison = compareValues(
      auditSortValue(a, sort.field),
      auditSortValue(b, sort.field),
      sort.direction
    )
    if (comparison !== 0) {
      return comparison
    }
  }
  return compareValues(a.id, b.id, view.sorts.at(-1)?.direction)
}
export function auditFilterMatches(
  row: AuditViewRow,
  filter: AuditViewFilter
): boolean {
  const value = auditSortValue(row, filter.field)
  if (
    filter.field === 'createdAt' &&
    (filter.operator === 'is' || filter.operator === 'isNot')
  ) {
    const [start, end] = filter.value.split('|')
    if (start && end) {
      const inside = value >= start && value <= end
      if (filter.operator === 'is') {
        return inside
      }
      return !inside
    }
  }
  switch (filter.operator) {
    case 'contains': {
      return value.includes(filter.value)
    }
    case 'notContains': {
      return !value.includes(filter.value)
    }
    case 'is': {
      return value === filter.value
    }
    case 'isNot': {
      return value !== filter.value
    }
    case 'before':
    case 'lt': {
      return value < filter.value
    }
    case 'after':
    case 'gt': {
      return value > filter.value
    }
    case 'isEmpty': {
      return value === ''
    }
    case 'isNotEmpty': {
      return value !== ''
    }
  }
  return false
}
export function auditRowMatchesView(row: AuditViewRow, view: AuditView): boolean {
  if (view.filters.length === 0) {
    return true
  }
  if (view.match === 'all') {
    return view.filters.every((filter) => auditFilterMatches(row, filter))
  }
  return view.filters.some((filter) => auditFilterMatches(row, filter))
}
