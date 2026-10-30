import { Schema } from 'effect'
import { NotificationList } from './notification-records'

export const listNotificationsServerFnResponse = NotificationList
export const markNotificationsReadServerFnResponse = Schema.Number
