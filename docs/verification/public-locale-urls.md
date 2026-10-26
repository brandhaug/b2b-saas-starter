# Public locale URL verification

Verified on 2026-10-25 against the unprefixed-English URL change, based on
`60419a6e180dd24f653585d416596fd1a9e5415a`, including the dependency security updates.

## Repeat

```bash
E2E_PORT=3197 pnpm run validate
```

Result: passed, including format, lint, types, package tests, script tests,
builds, Wrangler configuration verification, local database setup and Playwright.
Playwright reported 62 passed and 11 skipped. The skipped cases require optional
provider or runtime configuration; they are not counted as verified.
Playwright writes its machine-readable report to
`apps/web/playwright-report/results.json`.

## Observed behavior

- English home and pricing pages load at unprefixed URLs.
- Desktop language switching navigates to `/no`, preserves the home fragment,
  and retains Norwegian across docs navigation and refresh. Switching back
  returns to the unprefixed nested docs URL.
- Canonical and alternate-language links expose unprefixed English and `/no`
  Norwegian URLs. HTML language remains `nb` for Bokmål.
- An English public URL overrides Norwegian browser preferences. Authentication
  pages still detect Norwegian when no language cookie is present.
- Mobile language switching returns from `/no` to `/`; both language headers
  fit at 320px.
- Cold docs requests and recovery work in workerd with the new URL shapes.
- Deployment smoke tests accept the English homepage directly and reject the
  obsolete redirect to `/en`, while retaining release identity and asset checks.

Focused browser reproduction:

```bash
CI=1 E2E_PORT=3197 pnpm -C apps/web exec playwright test \
  e2e/i18n.spec.ts e2e/annual-pricing.spec.ts e2e/source-examples.spec.ts \
  --project=chromium --no-deps
```

The focused run passed all seven tests after local database migration and seeding.
