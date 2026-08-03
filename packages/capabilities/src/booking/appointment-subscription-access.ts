import type { EffectDatabase } from '@b2b-saas-starter/db'
import {
  authorizeSubscriptionAccess,
  type SubscriptionAccessOperation
} from '../subscriptions/subscription-access.ts'

export type AppointmentSubscriptionMutation =
  | 'merchant-create'
  | 'record-completed'
  | 'edit'
  | 'reschedule'
  | 'cancel'
  | 'complete'
  | 'no-show'
  | 'outcome-correction'
  | 'external-collection'
  | 'whole-party-cancel'

export const appointmentSubscriptionOperation = (
  mutation: AppointmentSubscriptionMutation
): SubscriptionAccessOperation =>
  mutation === 'merchant-create' || mutation === 'record-completed'
    ? 'new-demand'
    : 'existing-commitment'

export const authorizeAppointmentSubscriptionAccess = (
  db: EffectDatabase,
  merchantId: string,
  mutation: AppointmentSubscriptionMutation
) =>
  authorizeSubscriptionAccess(
    db,
    { merchantId },
    appointmentSubscriptionOperation(mutation)
  )
