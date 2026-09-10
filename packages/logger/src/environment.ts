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
 * Read one own property of an untyped env bag as a non-empty string. The
 * descriptor lookup keeps the own-property semantics without asserting a
 * dictionary type onto the caller's `object`.
 */
function ownStringValue(source: object, key: string): string | undefined {
  const value: unknown = Object.getOwnPropertyDescriptor(source, key)?.value
  // oxlint-disable-next-line anti-slop/no-runtime-typeof, effect/noTernary -- one env-bag string read with no domain contract behind it; the Schema codec this replaced was the over-engineering
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function pickString(
  source: object | undefined,
  ...keys: ReadonlyArray<string>
): string | undefined {
  if (!source) {
    return undefined
  }
  for (const key of keys) {
    const value = ownStringValue(source, key)
    if (value !== undefined) {
      return value
    }
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
  // Absent fields stay absent (no `key: undefined`), which keeps the emitted
  // wide event free of empty columns.
  return {
    ...(commit && { commitHash: commit }),
    ...(version && { serviceVersion: version }),
    ...(region && { region }),
    ...(environment && { environment })
  }
}

/** Cloudflare colo hint from an incoming request's `cf` object, if present. */
export function readCfColo(request: Request): string | undefined {
  if (!('cf' in request)) {
    return undefined
  }
  // SAFETY: `request.cf` is Cloudflare's untyped platform bag; the only claim
  // is that it may carry a `colo` string, checked on the next line.
  // oxlint-disable-next-line effect/noAs, typescript/no-unsafe-type-assertion -- one property off a platform bag Cloudflare does not type; a codec would validate a contract nobody publishes
  const colo: unknown = (request.cf as { readonly colo?: unknown }).colo
  // oxlint-disable-next-line anti-slop/no-runtime-typeof, effect/noTernary -- same single-string read as `ownStringValue`
  return typeof colo === 'string' && colo.length > 0 ? colo : undefined
}
