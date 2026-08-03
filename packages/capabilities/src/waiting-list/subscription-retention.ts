import type { CompiledBatchQuery } from '@b2b-saas-starter/db'

export const waitingListRetentionDisposition = (
  merchantId: string,
  now: string
): readonly CompiledBatchQuery[] => [
  {
    sql: `UPDATE waiting_list_applications
          SET customer_snapshot_json='{"name":"Erased customer","email":"erased@invalid"}',
              status=CASE WHEN status='active' THEN 'expired' ELSE status END,
              updated_at=? WHERE shop_id IN (SELECT id FROM shops WHERE merchant_id=?)`,
    params: [now, merchantId]
  }
]
