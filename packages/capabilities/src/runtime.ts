import { makeLiveLayerFromD1, type CapabilitiesLayer } from './layers.ts'

type D1Binding = Parameters<typeof makeLiveLayerFromD1>[0]

export type BookingProductEnv = {
  readonly DB: D1Binding
  readonly PLATFORM_API_CURSOR_SECRET?: string | undefined
  readonly REQUIRE_PLATFORM_API_CURSOR_SECRET?: boolean | undefined
}

export const selectCapabilitiesLayer = (env: BookingProductEnv): CapabilitiesLayer =>
  makeLiveLayerFromD1(env.DB, {
    platformApiCursorSecret: env.PLATFORM_API_CURSOR_SECRET,
    requirePlatformApiCursorSecret: env.REQUIRE_PLATFORM_API_CURSOR_SECRET
  })
