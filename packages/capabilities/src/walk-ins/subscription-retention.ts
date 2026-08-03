import type { CompiledBatchQuery } from '@b2b-saas-starter/db'

export const walkInRetentionDisposition = (
  merchantId: string,
  now: string
): readonly CompiledBatchQuery[] => [
  {
    sql: `UPDATE walk_in_entries SET contact_key=NULL,
            request_json=json_set(request_json,'$.contactKey','erased'),
            customer_snapshot_json='{"name":"Erased customer","email":"erased@invalid","phone":"erased"}',
            status=CASE WHEN status IN ('waiting','called','serving') THEN 'removed' ELSE status END,
            updated_at=? WHERE shop_id IN (SELECT id FROM shops WHERE merchant_id=?)`,
    params: [now, merchantId]
  }
]
