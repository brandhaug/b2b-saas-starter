import {
  listSystemUsersServerFn,
  loadAdminAuditEventsServerFn,
  loadFailedDeliveriesServerFn
} from './admin'

export async function loadAdminPage() {
  // oxlint-disable-next-line effect/noNewPromise -- parallel client-safe server-fn calls; importing Effect here would ship its runtime
  const [users, events, failedDeliveries] = await Promise.all([
    listSystemUsersServerFn(),
    loadAdminAuditEventsServerFn(),
    loadFailedDeliveriesServerFn({ data: {} })
  ])
  return { users, events, failedDeliveries }
}
