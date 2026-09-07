import {
  listSystemUsersServerFn,
  loadAdminAuditEventsServerFn,
  loadFailedDeliveriesServerFn
} from './admin'
import { loadSystemEmailDeliveryServerFn } from './email-delivery'

export async function loadAdminPage() {
  // oxlint-disable-next-line effect/noNewPromise -- parallel client-safe server-fn calls; importing Effect here would ship its runtime
  const [users, events, failedDeliveries, emailDeliveries] = await Promise.all([
    listSystemUsersServerFn(),
    loadAdminAuditEventsServerFn(),
    loadFailedDeliveriesServerFn({ data: {} }),
    loadSystemEmailDeliveryServerFn()
  ])
  return { users, events, failedDeliveries, emailDeliveries }
}
