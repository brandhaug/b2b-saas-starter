/// <reference types="bun-types" />
import { buildSeedBookingScenario } from '@b2b-saas-starter/capabilities/merchant-catalog'
import {
  account,
  appointments,
  brands,
  bookingSessions,
  checkoutPolicies,
  confirmationAccess,
  giftCardProducts,
  merchantMemberships,
  merchants,
  providerServiceEligibility,
  providers,
  publicBookingPages,
  pricingPolicies,
  scheduleRules,
  services,
  shopProviders,
  shopAddresses,
  shops,
  shopServices,
  user
} from '@b2b-saas-starter/db'
import { getTableColumns, getTableName, type Table } from 'drizzle-orm'

const scenario = buildSeedBookingScenario('2026-07-10T09:30:00.000Z')
const quote = (value: unknown): string => {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string')
    throw new Error(`unsupported seed value: ${typeof value}`)
  return `'${value.replaceAll("'", "''")}'`
}
const insert = <T extends Table>(
  table: T,
  row: { readonly [K in keyof T['_']['columns']]?: unknown }
): string => {
  const columns = getTableColumns(table)
  const entries = Object.entries(row).map(([key, value]) => {
    const column = columns[key]
    if (!column) throw new Error(`unknown ${getTableName(table)} column ${key}`)
    const driverValue = value == null ? null : column.mapToDriverValue(value)
    return [column.name, quote(driverValue)] as const
  })
  return `INSERT OR REPLACE INTO ${getTableName(table)} (${entries.map(([name]) => name).join(', ')}) VALUES (${entries.map(([, value]) => value).join(', ')});`
}

// Fixed Better Auth scrypt result for the documented local-only password. A
// generated salt would make otherwise identical seed runs produce different SQL.
const password =
  'ca9b62ad5583afec995d8ef2dc0b69ba:61c0b23c9c68f0e99269cdc4c50c2283e88913ef09fc3228b53eadaf846a4cb6c55d12caf3b08ab379faffaceb27632575fcff8828126a5c9c785e1c6bae4ec1'
const epoch = Math.floor(Date.parse(scenario.anchorTime) / 1000)
const brandId = `brd_${scenario.merchant.id}`
const shopId = `shp_${scenario.merchant.id}`
const statements = [
  'PRAGMA foreign_keys = ON;',
  // Booking parties restrict deletion of their shop. Clear transient booking
  // sessions first so reseeding remains idempotent after local booking flows.
  `DELETE FROM ${getTableName(bookingSessions)} WHERE merchant_id = ${quote(scenario.merchant.id)};`,
  `DELETE FROM ${getTableName(merchants)} WHERE id = ${quote(scenario.merchant.id)};`,
  insert(user, {
    id: scenario.owner.id,
    email: 'merchant@booking.local',
    name: scenario.owner.name,
    role: 'user',
    emailVerified: true,
    createdAt: epoch,
    updatedAt: epoch
  }),
  insert(account, {
    id: 'acc_seed_merchant',
    accountId: scenario.owner.id,
    providerId: 'credential',
    userId: scenario.owner.id,
    password,
    createdAt: epoch,
    updatedAt: epoch
  }),
  insert(merchants, {
    id: scenario.merchant.id,
    publicName: scenario.merchant.publicName,
    slug: scenario.merchant.slug,
    timezone: scenario.merchant.timezone,
    currency: scenario.merchant.currency,
    plan: scenario.merchant.plan,
    createdAt: scenario.anchorTime,
    updatedAt: scenario.anchorTime
  }),
  insert(brands, {
    id: brandId,
    merchantId: scenario.merchant.id,
    name: scenario.merchant.publicName,
    createdAt: scenario.anchorTime,
    updatedAt: scenario.anchorTime
  }),
  insert(shops, {
    id: shopId,
    brandId,
    merchantId: scenario.merchant.id,
    slug: scenario.merchant.slug,
    publicName: scenario.merchant.publicName,
    timezone: scenario.merchant.timezone,
    currency: scenario.merchant.currency,
    bookingConfigJson: {
      alias: 'Mara Ionescu',
      coverPhotoUrl:
        'https://images.unsplash.com/photo-1621605815971-fbc98d665033?auto=format&fit=crop&w=1200&q=80'
    },
    createdAt: scenario.anchorTime,
    updatedAt: scenario.anchorTime
  }),
  insert(pricingPolicies, {
    shopId,
    taxBasisPoints: 2100,
    taxLabel: 'VAT',
    taxIncluded: true,
    feeMinor: 0,
    feeLabel: 'Fee',
    version: 1,
    createdAt: scenario.anchorTime,
    updatedAt: scenario.anchorTime
  }),
  insert(shopAddresses, {
    id: 'sad_seed_booking_studio',
    shopId,
    addressJson: JSON.stringify({
      street: 'Strada Lipscani 21',
      city: 'București',
      postalCode: '030167',
      country: 'RO'
    }),
    latitude: '44.4314',
    longitude: '26.1002',
    createdAt: scenario.anchorTime,
    updatedAt: scenario.anchorTime
  }),
  insert(giftCardProducts, {
    id: 'gcp_seed_unassigned',
    merchantId: scenario.merchant.id,
    name: 'Mara Booking Studio Gift Card',
    currency: scenario.merchant.currency,
    scope: 'shop',
    scopeId: shopId,
    presetAmountsJson: JSON.stringify([10000, 20000, 30000]),
    allowsCustomAmount: true,
    customAmountMinMinor: 5000,
    customAmountMaxMinor: 50000,
    active: true,
    createdAt: scenario.anchorTime,
    updatedAt: scenario.anchorTime
  }),
  insert(merchantMemberships, {
    ...scenario.membership,
    createdAt: scenario.anchorTime
  }),
  ...scenario.providers.map((provider) =>
    insert(providers, {
      ...provider,
      createdAt: scenario.anchorTime,
      updatedAt: scenario.anchorTime
    })
  ),
  ...scenario.services.map((service) =>
    insert(services, {
      ...service,
      createdAt: scenario.anchorTime,
      updatedAt: scenario.anchorTime
    })
  ),
  insert(checkoutPolicies, {
    ...scenario.checkoutPolicy,
    merchantId: scenario.merchant.id,
    brandId: null,
    shopId: null,
    scope: 'merchant',
    scopeId: scenario.merchant.id
  }),
  ...scenario.providers.map((provider) =>
    insert(shopProviders, {
      shopId,
      providerId: provider.id,
      createdAt: scenario.anchorTime
    })
  ),
  ...scenario.services.map((service) =>
    insert(shopServices, {
      shopId,
      serviceId: service.id,
      createdAt: scenario.anchorTime
    })
  ),
  ...scenario.eligibility.map((pair) =>
    insert(providerServiceEligibility, {
      ...pair,
      createdAt: scenario.anchorTime
    })
  ),
  ...scenario.scheduleRules.map((rule) =>
    insert(scheduleRules, {
      ...rule,
      createdAt: scenario.anchorTime,
      updatedAt: scenario.anchorTime
    })
  ),
  ...scenario.appointments.map(({ customerDetails: _, ...appointment }) =>
    insert(appointments, {
      ...appointment,
      updatedAt: scenario.anchorTime
    })
  ),
  ...scenario.confirmationAccess.map((access) => insert(confirmationAccess, access)),
  insert(publicBookingPages, {
    ...scenario.publicBookingPage,
    createdAt: scenario.anchorTime,
    updatedAt: scenario.anchorTime
  })
]
export const buildSeedSql = (): string => `${statements.join('\n')}\n`

if (import.meta.main) {
  const sql = buildSeedSql()
  if (process.argv.includes('--print')) process.stdout.write(sql)
  else {
    await Bun.write('.context/seed-booking-product.sql', sql)
    const proc = Bun.spawn(
      [
        'bunx',
        'wrangler',
        'd1',
        'execute',
        'b2b-saas-starter',
        '--local',
        '--config=packages/db/wrangler.jsonc',
        '--file=.context/seed-booking-product.sql'
      ],
      { stdout: 'inherit', stderr: 'inherit' }
    )
    process.exit(await proc.exited)
  }
}
