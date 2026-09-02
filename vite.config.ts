import { defineConfig } from 'vite-plus'

import { lintConfig } from './lint.config.ts'

export default defineConfig({
  run: {
    // Turbo cached the `build`/`typecheck`/`test` package scripts; scripts are not
    // cached by default, so turn script caching on to keep that behaviour.
    cache: {
      scripts: true
    }
  },
  // Format-only staged checks: the hook keeps commits clean but does not gate
  // them. Lint and typecheck run in `pnpm run check` — agents and contributors
  // are required to run it before committing (see AGENTS.md), and pr-gate
  // enforces the same bar in CI.
  staged: {
    '*.{ts,tsx,js,jsx,json,md,mdx,css}': 'vp fmt --write'
  },
  fmt: {
    semi: false,
    singleQuote: true,
    trailingComma: 'none',
    printWidth: 88,
    indentStyle: 'tab',
    ignorePatterns: ['**/routeTree.gen.*', '**/*.d.ts']
  },
  // The lint block is the repo's largest piece of policy; it lives in
  // ./lint.config.ts so the decisions in it are readable. `vp` discovers only
  // this file, so importing it keeps `vp lint` working with no extra flags.
  lint: lintConfig
})
