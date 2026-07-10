import stylex from '@stylexjs/unplugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(() => ({
  // Customer URLs stay merchant-scoped. Production's output directory gives
  // compiled assets the stable internal prefix without mounting the app there.
  // Vite serves development runtime modules under the booking asset prefix;
  // production uses the output directory below so the worker still accepts
  // the canonical merchant-scoped page URLs directly.
  base: process.env.BOOKING_VITE_DEV === '1' ? '/_booking/' : '/',
  build: { assetsDir: '_booking/assets' },
  server: { host: 'localhost', port: 3073 },
  preview: { host: 'localhost', port: 3073 },
  resolve: { tsconfigPaths: true },
  plugins: [tanstackStart(), stylex.vite({ useCSSLayers: true }), viteReact()]
}))
