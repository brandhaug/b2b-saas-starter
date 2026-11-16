import { UserId, WorkspaceId } from '@b2b-saas-starter/db/ids'
import { Option, Result, Schema } from 'effect'
import { Base64 } from 'effect/encoding'
import {
  asciiFold,
  isActiveTableFilter,
  tableFieldOperators,
  tableFilterMatches
} from '../internal/table-filter.ts'

export const AuditViewField = Schema.Literals([
  'eventType',
  'actorUserId',
  'actorType',
  'createdAt'
])
export type AuditViewField = typeof AuditViewField.Type
/**
 * One condition, in the shared table-filter vocabulary. Every field is read
 * as text; a `createdAt` day travels as the inclusive instant range
 * `value`..`endValue` once the web boundary has widened it.
 */
export const AuditViewFilter = Schema.Union([
  Schema.Struct({
    field: Schema.Literals(['eventType', 'actorUserId', 'actorType']),
    operator: Schema.Literals(tableFieldOperators.text),
    value: Schema.String.check(Schema.isMaxLength(512))
  }),
  Schema.Struct({
    field: Schema.Literal('createdAt'),
    operator: Schema.Literals(tableFieldOperators.date),
    value: Schema.String.check(Schema.isMaxLength(128)),
    endValue: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(128)))
  })
])
export type AuditViewFilter = typeof AuditViewFilter.Type
export const AuditViewSort = Schema.Struct({
  field: AuditViewField,
  direction: Schema.Literals(['asc', 'desc'])
})
export type AuditViewSort = typeof AuditViewSort.Type
export const AuditView = Schema.Struct({
  match: Schema.Literals(['all', 'any']),
  filters: Schema.Array(AuditViewFilter).check(Schema.isMaxLength(12)),
  sorts: Schema.Array(AuditViewSort).check(Schema.isMaxLength(4))
})
export type AuditView = typeof AuditView.Type
export const defaultAuditView: AuditView = {
  match: 'all',
  filters: [],
  sorts: [{ field: 'createdAt', direction: 'desc' }]
}
export type AuditViewRow = {
  readonly id: string
  readonly eventType: string
  readonly actorUserId?: UserId | null
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
  workspaceId: Schema.optional(WorkspaceId),
  actorUserId: Schema.optional(UserId),
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
  workspaceId?: WorkspaceId,
  input?: {
    readonly actorUserId?: UserId | undefined
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
  const filters = view.filters.filter(isActiveTableFilter)
  if (view.sorts.length === 0) {
    return { match: view.match, filters, sorts: defaultAuditView.sorts }
  }
  return { match: view.match, filters, sorts: view.sorts }
}
export function encodeAuditCursor(cursor: AuditCursor): string {
  return Base64.encode(encodeCursor(cursor))
}
export function decodeAuditCursor(
  cursor: string | undefined,
  key: string,
  sortCount: number
): AuditCursor | null | undefined {
  if (cursor === undefined) {
    return
  }
  const decoded = Base64.decodeString(cursor)
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
  return tableFilterMatches(
    filter,
    'text',
    auditSortValue(row, filter.field),
    asciiFold
  )
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
