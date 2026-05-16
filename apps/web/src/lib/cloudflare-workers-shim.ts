const missingD1 = new Proxy(
  {},
  {
    get() {
      throw new Error('D1 binding is unavailable in the local workers shim')
    }
  }
) as D1Database

export const env = {
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'local-dev-secret',
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3071',
  BETTER_AUTH_TRUSTED_ORIGINS:
    process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? 'http://localhost:3071',
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
  DB: missingD1
}
