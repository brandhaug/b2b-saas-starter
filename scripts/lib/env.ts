/**
 * The one required-value boundary for Node-side operator CLIs, deploy scripts,
 * and CI helpers. These run before any Effect runtime exists, so `Config` has
 * nowhere to read from and `process.env` is the right API.
 */

type Environment = Readonly<Record<string, string | undefined>>

/** Read an environment variable, failing when it is unset or blank. */
export function requiredEnv(
  name: string,
  environment: Environment = process.env
): string {
  const value = environment[name]
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`missing required environment variable ${name}`)
  }
  return value
}

/** Fail when an already-read value — a CLI flag or resolved config — is absent. */
export function required<A>(value: A | undefined, label: string): A {
  if (value === undefined) {
    throw new Error(`Missing ${label}`)
  }
  return value
}
