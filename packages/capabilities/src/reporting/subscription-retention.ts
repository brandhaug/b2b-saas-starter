import type { CompiledBatchQuery } from '@b2b-saas-starter/db'

export const reportingRetentionDisposition = (
  merchantId: string
): readonly CompiledBatchQuery[] => [
  {
    sql: `UPDATE report_exports SET status='expired', artifact_ref=NULL WHERE merchant_id=?`,
    params: [merchantId]
  }
]
