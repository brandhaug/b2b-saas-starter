import { m } from '@b2b-saas-starter/i18n/messages'

/** Translate display labels while retaining the underlying role identifier. */
export function roleLabel(value: string): string {
  switch (value) {
    case 'owner': {
      return m.shell_role_owner()
    }
    case 'admin': {
      return m.shell_role_admin()
    }
    case 'member': {
      return m.shell_role_member()
    }
    case 'user': {
      return m.shell_role_user()
    }
    default: {
      return value
    }
  }
}

/** Translate display labels while retaining the underlying status identifier. */
export function statusLabel(value: string): string {
  switch (value) {
    case 'pending': {
      return m.shell_status_pending()
    }
    case 'accepted': {
      return m.shell_status_accepted()
    }
    case 'rejected': {
      return m.shell_status_rejected()
    }
    case 'canceled': {
      return m.shell_status_canceled()
    }
    case 'delivered': {
      return m.shell_status_delivered()
    }
    case 'failed': {
      return m.shell_status_failed()
    }
    case 'failed_permanent': {
      return m.shell_status_failed_permanent()
    }
    case 'dead_lettered': {
      return m.shell_status_dead_lettered()
    }
    case 'ready': {
      return m.shell_status_ready()
    }
    default: {
      return value
    }
  }
}
