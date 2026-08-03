import type { CompiledBatchQuery } from '@b2b-saas-starter/db'

export const bookingRetentionDisposition = (
  merchantId: string,
  now: string
): readonly CompiledBatchQuery[] => [
  {
    sql: `UPDATE booking_sessions
          SET customer_name=NULL, customer_email=NULL, customer_phone=NULL,
              acquisition_json=NULL
          WHERE merchant_id=?`,
    params: [merchantId]
  },
  {
    sql: `UPDATE booking_requests SET customer_account_id=NULL, customer_details_json=NULL
          WHERE booking_party_id IN (
            SELECT bp.id FROM booking_parties bp JOIN booking_sessions bs
              ON bs.id=bp.booking_session_id WHERE bs.merchant_id=?)`,
    params: [merchantId]
  },
  {
    sql: `UPDATE appointments
          SET snapshot=json_set(snapshot,
            '$.customerDetails.name','Erased customer',
            '$.customerDetails.email','erased@invalid',
            '$.customerDetails.phone',NULL), updated_at=?
          WHERE merchant_id=? AND snapshot IS NOT NULL AND json_valid(snapshot)`,
    params: [now, merchantId]
  }
]
