import { type TableViewField } from './table-view'
import { statusLabel } from './value-labels'
import { m } from '@b2b-saas-starter/i18n/messages'

export function failedDeliveryFields(): ReadonlyArray<TableViewField> {
  return [
    { id: 'endpointUrl', label: m.endpoint_url(), kind: 'text' },
    { id: 'workspace', label: m.common_workspaces(), kind: 'text' },
    { id: 'eventType', label: m.event_type_label(), kind: 'text' },
    {
      id: 'status',
      label: m.common_status(),
      kind: 'select',
      options: [
        { value: 'dead_lettered', label: statusLabel('dead_lettered') },
        { value: 'failed_permanent', label: statusLabel('failed_permanent') }
      ]
    },
    { id: 'attempts', label: m.attempts_label(), kind: 'number' },
    { id: 'lastAttemptAt', label: m.last_attempt_label(), kind: 'date' }
  ]
}
