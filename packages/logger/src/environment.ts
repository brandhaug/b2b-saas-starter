import { Option, Schema } from 'effect'

/**
 * Deployment identity mined from a worker env bag (plus Cloudflare's `cf`
 * hints). Each field has its own precedence chain over the raw env keys —
 * first present wins:
 *
 * | Field          | Precedence (left wins)                              |
 * | -------------- | --------------------------------------------------- |
 * | `commitHash`   | `GIT_COMMIT_SHA` → `CF_VERSION_METADATA_ID`         |
 * | `serviceVersion`| `SERVICE_VERSION` → `WORKERS_CI_BUILD_UUID`        |
 * | `region`       | cf `colo` hint → cf `region` hint → `CF_REGION` env |
 * | `environment`  | `ENVIRONMENT` → `NODE_ENV`                          |
 */
export type WideEventEnvironment = {
  readonly commitHash?: string | undefined
  readonly serviceVersion?: string | undefined
  readonly region?: string | undefined
  readonly environment?: string | undefined
}

/**
 * The write-side view of {@link WideEventEnvironment}. `readWideEventEnvironment`
 * fills it key by key so an unset var stays an absent key rather than an
 * explicit `undefined`, which `exactOptionalPropertyTypes` treats as a present
 * value and the emitted event would show as an empty column.
 */
type MutableWideEventEnvironment = {
  -readonly [K in keyof WideEventEnvironment]: WideEventEnvironment[K]
}

const CfProperties = Schema.Struct({ colo: Schema.String })

const decodeCfProperties = Schema.decodeUnknownOption(CfProperties)
const decodeString = Schema.decodeUnknownOption(Schema.String)

/**
 * Read one own property of an untyped env bag as a non-empty string. The
 * descriptor lookup keeps the own-property semantics without asserting a
 * dictionary type onto the caller's `object`.
 */
function ownStringValue(source: object, key: string): string | undefined {
  const value: unknown = Object.getOwnPropertyDescriptor(source, key)?.value
  const decoded = decodeString(value)
  if (Option.isNone(decoded) || decoded.value.length === 0) return undefined
  return decoded.value
}

function pickString(
  source: object | undefined,
  ...keys: readonly string[]
): string | undefined {
  if (!source) return undefined
  for (const key of keys) {
    const value = ownStringValue(source, key)
    if (value !== undefined) return value
  }
  return undefined
}

export function readWideEventEnvironment(
  source: object | undefined,
  hints?: {
    readonly colo?: string | undefined
    readonly region?: string | undefined
  }
): WideEventEnvironment {
  // Per-field precedence chains are documented on `WideEventEnvironment`.
  const commit = pickString(source, 'GIT_COMMIT_SHA', 'CF_VERSION_METADATA_ID')
  const version = pickString(source, 'SERVICE_VERSION', 'WORKERS_CI_BUILD_UUID')
  const region = hints?.colo ?? hints?.region ?? pickString(source, 'CF_REGION')
  const environment = pickString(source, 'ENVIRONMENT', 'NODE_ENV')
  // Built by assignment so absent fields stay absent (no `key: undefined`),
  // which keeps the emitted wide event free of empty columns.
  const resolved: MutableWideEventEnvironment = {}
  if (commit) resolved.commitHash = commit
  if (version) resolved.serviceVersion = version
  if (region) resolved.region = region
  if (environment) resolved.environment = environment
  return resolved
}

/** Cloudflare colo hint from an incoming request's `cf` object, if present. */
export function readCfColo(request: Request): string | undefined {
  if (!('cf' in request)) return undefined
  const cf = decodeCfProperties(request.cf)
  if (Option.isNone(cf)) return undefined
  return cf.value.colo
}

/** Region hints for the environment enrichment; absent when there is no colo. */
export function coloHint(
  colo: string | undefined
): { readonly colo: string } | undefined {
  if (colo === undefined) return undefined
  return { colo }
}
