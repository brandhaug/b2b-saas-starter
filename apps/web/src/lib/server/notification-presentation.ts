import { type Notification } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { renderNotificationEvent } from '@b2b-saas-starter/capabilities/notifications/notification-events'
import { getLocale } from '@b2b-saas-starter/i18n/runtime'

import { requestPresentation } from './i18n-context'

/**
 * Presents durable system events for the current request. The event payload
 * stays in storage so changing an account's locale changes old notifications
 * too; user-authored announcements have no event and retain their literal
 * title and message. The event itself is omitted from the browser payload.
 */
export function presentNotifications(
  notifications: ReadonlyArray<Notification>
): ReadonlyArray<Notification> {
  const locale = getLocale()
  const { timeZone } = requestPresentation()
  return notifications.map((notification) => {
    if (notification.event === undefined) {
      return notification
    }
    const literal = { ...notification }
    delete literal.event
    return {
      ...literal,
      ...renderNotificationEvent(notification.event, locale, timeZone)
    }
  })
}
