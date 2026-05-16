import { Layer } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import {
  LiveCapabilitiesLayer,
  makeLiveLayerFromD1,
  SeedLayer,
  type CapabilitiesLayer,
  type CapabilityServices
} from './layers.ts'
import { seedWorkspaceRecord } from './seed-fixture.ts'
import {
  liveWorkspaceContext,
  seedWorkspaceContext,
  WorkspaceContext,
  type Actor
} from './workspace-context.ts'
import type { WorkspaceNotFound } from './errors.ts'

type D1Binding = Parameters<typeof layerFromD1>[0]

export type StarterEnv = {
  readonly DB?: D1Binding
}

export const selectCapabilitiesLayer = (env: StarterEnv): CapabilitiesLayer =>
  env.DB ? makeLiveLayerFromD1(env.DB) : SeedLayer

export const selectWorkspaceLayer = (
  env: StarterEnv,
  slug: string,
  actor?: Actor
): Layer.Layer<CapabilityServices | WorkspaceContext, WorkspaceNotFound> => {
  if (env.DB) {
    return Layer.mergeAll(
      LiveCapabilitiesLayer,
      liveWorkspaceContext(slug, actor)
    ).pipe(Layer.provide(layerFromD1(env.DB)))
  }
  return Layer.merge(SeedLayer, seedWorkspaceContext(seedWorkspaceRecord, slug, actor))
}
