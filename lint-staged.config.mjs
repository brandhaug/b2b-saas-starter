export default {
  '*.{ts,tsx,js,jsx,json,md,mdx,css}': ['oxfmt --write'],
  // `--type-aware` matches `bun run lint`, so the hook and CI enforce the same rules.
  // It costs about 1s: tsgolint builds the TypeScript program either way, so the price
  // is nearly the same for one staged file as for the whole repo.
  '*.{ts,tsx,js,jsx}': ['oxlint --type-aware --fix']
}
