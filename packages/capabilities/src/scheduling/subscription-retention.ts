import type { CompiledBatchQuery } from '@b2b-saas-starter/db'

export const schedulingRetentionDisposition = (
  merchantId: string,
  now: string
): readonly CompiledBatchQuery[] => [
  { sql: `DELETE FROM schedule_rules WHERE merchant_id=?`, params: [merchantId] },
  { sql: `DELETE FROM schedule_exceptions WHERE merchant_id=?`, params: [merchantId] },
  { sql: `DELETE FROM blocked_times WHERE merchant_id=?`, params: [merchantId] },
  {
    sql: `UPDATE public_booking_pages SET status='unpublished', updated_at=?
          WHERE merchant_id=?`,
    params: [now, merchantId]
  },
  {
    sql: `UPDATE merchant_activation_states SET business_details_confirmed_at=NULL,
            owner_provider_confirmed_at=NULL, exception_review_confirmed_at=NULL,
            booking_policies_json=NULL, policies_confirmed_at=NULL,
            launch_test_source_revision=NULL, launch_test_passed_at=NULL,
            revision=revision+1, updated_at=? WHERE merchant_id=?`,
    params: [now, merchantId]
  },
  {
    sql: `UPDATE appointment_series
          SET service_snapshot_json='{}',
              customer_snapshot_json='{"name":"Erased customer","email":"erased@invalid"}',
              status='cancelled_remaining', updated_at=? WHERE merchant_id=?`,
    params: [now, merchantId]
  }
]
