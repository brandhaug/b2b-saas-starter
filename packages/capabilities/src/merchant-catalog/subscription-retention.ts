import type { CompiledBatchQuery } from '@b2b-saas-starter/db'

export const merchantCatalogRetentionDisposition = (
  merchantId: string,
  now: string
): readonly CompiledBatchQuery[] => [
  {
    sql: `UPDATE merchants SET public_name='Closed merchant', slug='closed-'||id,
            status='disabled', booking_config_json=NULL, updated_at=? WHERE id=?`,
    params: [now, merchantId]
  },
  {
    sql: `UPDATE brands SET name='Closed merchant', booking_config_json=NULL,
            updated_at=? WHERE merchant_id=?`,
    params: [now, merchantId]
  },
  {
    sql: `UPDATE shops SET public_name='Closed shop', slug='closed-'||id,
            booking_config_json=NULL, updated_at=? WHERE merchant_id=?`,
    params: [now, merchantId]
  },
  {
    sql: `UPDATE shop_addresses SET address_json='{}', latitude=NULL, longitude=NULL,
            updated_at=? WHERE shop_id IN (SELECT id FROM shops WHERE merchant_id=?)`,
    params: [now, merchantId]
  },
  {
    sql: `UPDATE providers SET display_name='Closed provider',
            booking_access='restricted', booking_access_verifier_hash=NULL,
            booking_config_json=NULL, updated_at=? WHERE merchant_id=?`,
    params: [now, merchantId]
  },
  {
    sql: `UPDATE services SET name='Retired service', description=NULL, category=NULL,
            status='inactive', booking_config_json=NULL, updated_at=? WHERE merchant_id=?`,
    params: [now, merchantId]
  },
  {
    sql: `DELETE FROM provider_service_eligibility WHERE merchant_id=?`,
    params: [merchantId]
  }
]
