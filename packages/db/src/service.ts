import { Context, Layer } from 'effect'
import { type Database as DrizzleDatabase, createDb } from './client.ts'

export class Database extends Context.Service<Database, DrizzleDatabase>()(
  '@b2b-saas-starter/db/Database'
) {}

export const layerFromDb = (db: DrizzleDatabase): Layer.Layer<Database> =>
  Layer.succeed(Database)(db)

export const layerFromD1 = (
  d1: Parameters<typeof createDb>[0]
): Layer.Layer<Database> => Layer.succeed(Database)(createDb(d1))
