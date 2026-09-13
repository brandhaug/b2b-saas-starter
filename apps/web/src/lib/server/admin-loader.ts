import { pickOptionalStrings } from '../utils'
import { parseTableView, serializeTableView } from '../table-view'
import { failedDeliveryFields } from '../failed-delivery-fields'
import {
  listSystemUsersServerFn,
  loadAdminAuditEventsServerFn,
  loadFailedDeliveriesServerFn,
  listAdminWorkspacesServerFn
} from './admin'
import { loadSystemEmailDeliveryServerFn } from './email-delivery'

export async function loadAdminPage(
  failures: {
    readonly view?: string | undefined
    readonly cursor?: string | undefined
  } = {}
) {
  const failureInput = pickOptionalStrings(
    {
      cursor: failures.cursor,
      view: serializeTableView(parseTableView(failures.view, failedDeliveryFields()))
    },
    ['cursor', 'view']
  )
  // oxlint-disable effect/noNewPromise -- parallel client-safe server-fn calls; importing Effect here would ship its runtime
  const [users, events, failedDeliveries, emailDeliveries, workspaces] =
    await Promise.all([
      listSystemUsersServerFn(),
      loadAdminAuditEventsServerFn(),
      loadFailedDeliveriesServerFn({ data: failureInput }),
      loadSystemEmailDeliveryServerFn(),
      listAdminWorkspacesServerFn()
    ])
  // oxlint-enable effect/noNewPromise
  return { users, events, failedDeliveries, emailDeliveries, workspaces }
}
