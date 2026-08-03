import type { CompiledBatchQuery } from '@b2b-saas-starter/db'

export const customerDirectoryRetentionDisposition = (
  merchantId: string,
  now: string
): readonly CompiledBatchQuery[] => [
  {
    sql: `UPDATE customer_records SET display_name='Erased customer', status='erased',
            merchant_note=NULL, updated_at=?, revision=revision+1
          WHERE merchant_id=? AND status<>'erased'`,
    params: [now, merchantId]
  },
  {
    sql: `UPDATE customer_contacts SET normalized_value='erased:'||id, status='erased',
            is_preferred=0, verified_at=NULL, updated_at=? WHERE merchant_id=?`,
    params: [now, merchantId]
  },
  {
    sql: `UPDATE customer_observations SET name='Erased customer', normalized_email=NULL,
            normalized_phone=NULL WHERE merchant_id=?`,
    params: [merchantId]
  },
  {
    sql: `UPDATE customer_bans SET reason='erased' WHERE merchant_id=?`,
    params: [merchantId]
  },
  {
    sql: `UPDATE customer_directory_states
          SET state_json='{"records":[],"commands":[],"imports":[]}',
              revision=revision+1, updated_at=? WHERE merchant_id=?`,
    params: [now, merchantId]
  }
]
