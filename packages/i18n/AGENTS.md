# @b2b-saas-starter/i18n

Paraglide message compilation and locale resolution. Source catalogs live in `messages/<domain>/<locale>.json`; `scripts/compile.mjs` merges, validates and compiles them into `src/generated`, which the package re-exports through stable entry points (`./messages`, `./runtime`, `./server`).

## Contracts

- `src/locale.ts` owns the closed locale set. `LOCALES` is the single source: `Locale`, `isLocale` and the compile step's locale list all derive from it, and `validateProjectLocales` fails the build when `project.inlang/settings.json` disagrees.
- `scripts/catalog-validation.mjs` is the build's gate: duplicate keys across domain catalogs, alias collisions from flattening dotted and nested keys, missing translations in either direction, and placeholder-set mismatches all fail the compile.
- `routes.json` states which paths are localized. The compile step turns it into Paraglide `routeStrategies`; nothing else may restate a path prefix.
- `localeFromLanguage` resolves an `Accept-Language` value or a browser list. `no` and `nb-NO` map to Bokmål; unsupported, empty and wildcard-only values fall back to English.

## Changes

Run `pnpm -C packages/i18n generate` after touching a catalog, `routes.json`, or `src/locale.ts` — every script in this package runs it first, and the fingerprint over those inputs is what skips a redundant recompile.

## Boundaries

- Never import `src/generated/**` from outside this package; the entry points are the stable convention.
- Never edit `src/generated` or `.generated`; both are compiler output.
- `plugin-message-format.js` is the local bridge `project.inlang/settings.json` loads, and the reason `@inlang/plugin-message-format` is a devDependency no source file imports. Dead-code tools need it in their ignore list.
- Adding a locale means `LOCALES`, `intlLocale`, `localeFromLanguage`, the inlang settings, the URL patterns in `scripts/compile.mjs`, and a full catalog per domain — the validation refuses a partial one.
