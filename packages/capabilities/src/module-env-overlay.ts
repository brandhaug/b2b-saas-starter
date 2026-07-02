import { Effect, Layer } from 'effect'
import {
  StarterModuleCatalog,
  type ModuleStatus
} from './catalog/starter-module-catalog.ts'
import { IntegrationSurfaces } from './notifications/integration-surfaces.ts'
import type { CapabilityServices } from './layers.ts'

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
const catalogModuleEnvIds: Record<string, string> = {
  'better-auth': 'better-auth',
  'cloudflare-email': 'cloudflare-email',
  observability: 'observability'
}

// integration surface provider → env module id.
const integrationProviderEnvIds: Record<string, string> = {
  github: 'github-oauth',
  stripe: 'billing',
  turnstile: 'turnstile'
}

// missing env → needs-config; env present but the runtime isn't wired yet
// (e.g. billing) → attention; fully configured → ready.
const envDerivedStatus = (status: ModuleEnvStatus): ModuleStatus =>
  !status.envPresent ? 'needs-config' : status.configured ? 'ready' : 'attention'

const moduleEnvOverlay = (
  statuses: readonly ModuleEnvStatus[]
): Layer.Layer<
  StarterModuleCatalog | IntegrationSurfaces,
  never,
  StarterModuleCatalog | IntegrationSurfaces
> => {
  const byEnvModuleId = new Map(statuses.map((status) => [status.moduleId, status]))
  const catalogOverlay = Layer.effect(StarterModuleCatalog)(
    Effect.gen(function* () {
      const base = yield* StarterModuleCatalog
      return {
        ...base,
        listModules: Effect.map(base.listModules, (modules) =>
          modules.map((module) => {
            const status = byEnvModuleId.get(catalogModuleEnvIds[module.id] ?? '')
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
            const status = byEnvModuleId.get(
              integrationProviderEnvIds[surface.provider] ?? ''
            )
            if (status === undefined) return surface
            return {
              ...surface,
              status: envDerivedStatus(status),
              summary: status.envPresent
                ? surface.summary
                : `Set ${status.missing.join(', ')} to activate this integration.`
            }
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
export const withModuleEnvStatus = <R, E>(
  layer: Layer.Layer<CapabilityServices | R, E>,
  statuses: readonly ModuleEnvStatus[] | undefined
): Layer.Layer<CapabilityServices | R, E> =>
  statuses === undefined
    ? layer
    : moduleEnvOverlay(statuses).pipe(Layer.provideMerge(layer))
