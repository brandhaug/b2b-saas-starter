import { drizzle } from 'drizzle-orm/d1'

/**
 * The promise-based drizzle client over a raw D1 binding. Kept solely for
 * Better Auth's `drizzleAdapter` (`packages/auth`), which needs promises —
 * application code uses the Effect-native `Database` service instead.
 */
export function createDrizzleDb(d1: Parameters<typeof drizzle>[0]) {
  return drizzle(d1)
}

export type DrizzleDatabase = ReturnType<typeof createDrizzleDb>
