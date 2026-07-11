import { buildSeedBookingScenario } from '@b2b-saas-starter/capabilities'
import {
  account,
  appointments,
  confirmationAccess,
  merchantMemberships,
  merchants,
  providerServiceEligibility,
  providers,
  publicBookingPages,
  scheduleRules,
  services,
  user
} from '@b2b-saas-starter/db'
import { hashPassword } from 'better-auth/crypto'
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

const password = await hashPassword('merchant-booking-password')
const epoch = Math.floor(Date.parse(scenario.anchorTime) / 1000)
const statements = [
  'PRAGMA foreign_keys = ON;',
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
  ...scenario.appointments.map((appointment) => insert(appointments, appointment)),
  ...scenario.confirmationAccess.map((access) => insert(confirmationAccess, access)),
  insert(publicBookingPages, {
    ...scenario.publicBookingPage,
    createdAt: scenario.anchorTime,
    updatedAt: scenario.anchorTime
  })
]
const sql = `${statements.join('\n')}\n`
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
