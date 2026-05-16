import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  driver: 'd1-http',
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? 'local',
    databaseId: process.env.CLOUDFLARE_DATABASE_ID ?? 'local',
    token: process.env.CLOUDFLARE_D1_TOKEN ?? 'local'
  }
})
