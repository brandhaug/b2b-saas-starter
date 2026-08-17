import { Effect, Layer } from 'effect'
import {
  StarterModuleCatalog,
  type ModuleStatus
} from './catalog/starter-module-catalog.ts'
import { IntegrationSurfaces } from './notifications/integration-surfaces.ts'
import { type CapabilityServices } from './layers.ts'

/**
 * Env-derived configuration status for one optional module, as produced by
 * `moduleConfigStatus` in `@b2b-saas-starter/env` (ADR 0035). Structurally
 * identical to that package's `ModuleConfigStatus` so callers can pass the
 * result straight through without coupling this package to the env package.
 * Redacted by construction: only env var *names* appear, never values.
 */
export type ModuleEnvStatus = {
  readonly moduleId: string
  readonly configured: boolean
  readonly envPresent: boolean
  readonly missing: readonly string[]
}

// env module id → starter module catalog id (identity today, kept explicit so
// a rename on either side is a visible one-line change). Env module ids with
// no entry here or below (e.g. 'ai', which has no catalog module or
// integration surface yet) are ignored by the overlay.
//
// Maps rather than object literals: both are looked up by a runtime id that may
// have no mapping, and `Map#get` returns that absence as `undefined` instead of
// needing an index signature that claims every string is a key.
const catalogModuleEnvIds = new Map([
  ['better-auth', 'better-auth'],
  ['cloudflare-email', 'cloudflare-email'],
  ['observability', 'observability']
])

// integration surface provider → env module id.
const integrationProviderEnvIds = new Map([
  ['github', 'github-oauth'],
  ['stripe', 'billing'],
  ['turnstile', 'turnstile']
])

// missing env → needs-config; env present but the runtime isn't wired yet
// (e.g. billing) → attention; fully configured → ready.
function envDerivedStatus(status: ModuleEnvStatus): ModuleStatus {
  if (!status.envPresent) return 'needs-config'
  if (!status.configured) return 'attention'
  return 'ready'
}

function moduleEnvOverlay(
  statuses: readonly ModuleEnvStatus[]
): Layer.Layer<
  StarterModuleCatalog | IntegrationSurfaces,
  never,
  StarterModuleCatalog | IntegrationSurfaces
> {
  const byEnvModuleId = new Map(statuses.map((status) => [status.moduleId, status]))
  const catalogOverlay = Layer.effect(StarterModuleCatalog)(
    Effect.gen(function* () {
      const base = yield* StarterModuleCatalog
      return {
        ...base,
        listModules: Effect.map(base.listModules, (modules) =>
          modules.map((module) => {
            const envModuleId = catalogModuleEnvIds.get(module.id)
            if (envModuleId === undefined) return module
            const status = byEnvModuleId.get(envModuleId)
            if (status === undefined) return module
            return {
              ...module,
              state: {
                ...module.state,
                status: envDerivedStatus(status),
                missingConfig: status.missing
              }
            }
          })
        )
      }
    })
  )
  const integrationsOverlay = Layer.effect(IntegrationSurfaces)(
    Effect.gen(function* () {
      const base = yield* IntegrationSurfaces
      return {
        list: Effect.map(base.list, (surfaces) =>
          surfaces.map((surface) => {
            const envModuleId = integrationProviderEnvIds.get(surface.provider)
            if (envModuleId === undefined) return surface
            const status = byEnvModuleId.get(envModuleId)
            if (status === undefined) return surface
            if (!status.envPresent) {
              return {
                ...surface,
                status: envDerivedStatus(status),
                summary: `Set ${status.missing.join(', ')} to activate this integration.`
              }
            }
            return { ...surface, status: envDerivedStatus(status) }
          })
        )
      }
    })
  )
  return Layer.merge(catalogOverlay, integrationsOverlay)
}

/**
 * Decorates `StarterModuleCatalog` and `IntegrationSurfaces` so the statuses
 * they report reflect the worker's real environment instead of stored fixture
 * state (CLAUDE.md rule 3 / ADR 0035). Modules without an env mapping pass
 * through untouched. `undefined` statuses (caller has no env information)
 * leave the layer as-is.
 */
export function withModuleEnvStatus<R, E>(
  layer: Layer.Layer<CapabilityServices | R, E>,
  statuses: readonly ModuleEnvStatus[] | undefined
): Layer.Layer<CapabilityServices | R, E> {
  if (statuses === undefined) return layer
  return moduleEnvOverlay(statuses).pipe(Layer.provideMerge(layer))
}
