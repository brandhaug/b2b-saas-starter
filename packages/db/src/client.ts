import { drizzle } from 'drizzle-orm/d1'

export function createDb(d1: Parameters<typeof drizzle>[0]) {
  return drizzle(d1)
}

export type Database = ReturnType<typeof createDb>
