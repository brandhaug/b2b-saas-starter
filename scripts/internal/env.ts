/**
 * The two "this must be present" checks every operator CLI in this repo needs,
 * in one place. Nine scripts had grown their own `required`/`requiredEnv` with
 * three different signatures and four different messages, which is how one of
 * them ended up treating a whitespace-only value as configured.
 *
 * These run at the Node CLI boundary, outside any Effect runtime, so they
 * throw rather than returning a typed failure.
 */

/** A `process.env`-shaped bag: every key may be absent. */
export type EnvironmentSource = Readonly<Record<string, string | undefined>>

/**
 * One required environment variable. Whitespace-only counts as missing: a
 * deploy secret that is set to spaces is a misconfiguration, not a value.
 */
export function requiredEnv(environment: EnvironmentSource, name: string): string {
  const value = environment[name]
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`missing required environment variable ${name}`)
  }
  return value
}

/**
 * One required value that is not an environment variable — a CLI flag, or a
 * field an earlier step should have produced. `label` is what the operator
 * should go set, spelled the way they would type it (`--workspace <id>`).
 */
export function requiredValue(value: string | undefined, label: string): string {
  if (value === undefined) {
    throw new Error(`Missing ${label}`)
  }
  return value
}
