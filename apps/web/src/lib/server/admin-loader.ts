import {
  listSystemUsersServerFn,
  loadAdminAuditEventsServerFn,
  loadFailedDeliveriesServerFn,
  listAdminWorkspacesServerFn
} from './admin'
import { loadSystemEmailDeliveryServerFn } from './email-delivery'

export async function loadAdminPage() {
  // oxlint-disable effect/noNewPromise -- parallel client-safe server-fn calls; importing Effect here would ship its runtime
  const [users, events, failedDeliveries, emailDeliveries, workspaces] =
    await Promise.all([
      listSystemUsersServerFn(),
      loadAdminAuditEventsServerFn(),
      loadFailedDeliveriesServerFn({ data: {} }),
      loadSystemEmailDeliveryServerFn(),
      listAdminWorkspacesServerFn()
    ])
  // oxlint-enable effect/noNewPromise
  return { users, events, failedDeliveries, emailDeliveries, workspaces }
}
