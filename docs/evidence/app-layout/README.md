# App layout evidence

Before screenshots use commit `2de7e5dc94ad4a7b0bb49f399175a5df2267b193`. After screenshots use this PR's working tree after replacing the permanent right sidebar with an on-demand setup sheet, plus the Settings rail link and short-window accessibility fixes. The scope is workspace, account, admin, and demo pages. Public and authentication layouts are unchanged; the two embedded public preview images now show the new app layout.

The [supplied wireframe](reference.png) defines the layout regions. The follow-up design keeps the right side free until a task opens a drawer or sheet.

## Reproduce

Run from `apps/web` with migrated, seeded local D1 state and the E2E preview prerequisites installed:

```sh
E2E_PORT=3097 EVIDENCE_PHASE=after EVIDENCE_SUSPENDED=1 pnpm exec playwright test e2e/app-layout-evidence.spec.ts --project=chromium --workers=1
```

For the baseline, use a separate checkout at the commit above with its own dependencies and local database. Copy the evidence spec into that checkout and run with `EVIDENCE_PHASE=before`. Never run the before command on the final branch; it would overwrite historical evidence. The recovery capture temporarily suspends the local Starter Lab workspace through the admin UI and restores it in `finally`. The forbidden capture signs in as the seeded member and opens the audit page.

The suite skips unless `EVIDENCE_PHASE` is set. `EVIDENCE_SUSPENDED=1` explicitly enables the temporary local suspension. The built E2E preview is used because the development server returned generic 404 responses in this environment.

## Observed results

- Baseline matrix on 2026-10-02: 64 tests passed in 32.8 seconds, including authentication setup and cleanup. All 62 route captures passed.
- Baseline recovery and forbidden pages: 4 tests passed in 10.0 seconds using an isolated archive of the baseline commit and a copied local database. The workspace was restored to active.
- Initial layout revision on 2026-10-02: 70 tests passed in 39.9 seconds, including authentication setup and cleanup, 68 captures, navigation smoke, and short-window/touch-target checks. The suspended workspace was restored to active.
- Final on-demand drawer revision on 2026-10-02: 74 tests passed in 45.2 seconds, including authentication setup and cleanup, all 72 after captures, the setup-sheet checks, navigation smoke, and short-window/touch-target checks. The temporary suspension was reversed.

Each capture checks the expected heading, hydrated controls, selected tab when applicable, and absence of horizontal document overflow. Screenshots use dark mode and reduced motion. The navigation smoke uses 12 browser actions to open rail Search, navigate through related-page and Settings links, observe a local demo write refusal, and reach the mobile navigation sign-in exit at 320 × 400. Additional checks verify Settings and the account menu do not overlap at 1440 × 400, and the footer Support target is at least 44 × 44 at widths 390 and 700.

## Validation and review

`pnpm run validate` passed on 2026-10-02 for the final on-demand sheet implementation. It includes typechecking, lint, formatting, dead-code and translation checks, existing test suites, production builds, Wrangler drift checks, local migration/seeding, and browser regression tests. The regular browser run passed 53 tests in 41.6 seconds and skipped the 72 opt-in evidence cases, which passed separately in the capture run above. The script suite also has 11 existing opt-in skips.

Independent Standards, Spec, and fresh Impeccable reviews completed for the final revision with no remaining blockers. The existing owner and member checklist tests now open the setup sheet before their assertions; all five dashboard tests pass.

## On-demand setup check

Before the drawer implementation, the focused command below failed as expected because `aside.app-context` still existed. The demo desktop case observed one persistent aside instead of zero; the runner stopped before the other three cases.

```sh
E2E_PORT=3097 EVIDENCE_PHASE=after pnpm exec playwright test e2e/app-layout-evidence.spec.ts --project=chromium --workers=1 --grep 'on-demand setup' --max-failures=1
```

The first post-change focused run passed all 6 tests in 16.6 seconds, including authentication setup and cleanup. The final full run also waits for hydration before clicking the setup trigger and expands the developer steps to verify scrolling in a short mobile window.

The check requires no permanent right aside, a main column extending to the right viewport edge, an initially closed setup sheet, visible checklist content after opening, no sheet overflow, reachable content at 390 × 400, and Escape closing the sheet with focus restored to its trigger.

## Reading the images

The main matrix uses 1440 × 1000 desktop and 390 × 844 mobile viewports with full-page PNGs. The fixed footer appears at the initial viewport boundary in tall full-page images and can cover a strip of that static image. The live page remains scrollable. The public preview pairs are viewport-only images at 1440 × 1000 and 390 × 720; their before images are lossless PNG conversions of the committed WebPs, and their after images are encoded as lossless WebPs for the public page.

Each contact sheet shows all full-page and preview captures at one viewport. Open the individual PNGs below for readable text and close inspection.

| Viewport | Before                                            | After                                            |
| -------- | ------------------------------------------------- | ------------------------------------------------ |
| Desktop  | [Contact sheet](before/desktop-contact-sheet.jpg) | [Contact sheet](after/desktop-contact-sheet.jpg) |
| Mobile   | [Contact sheet](before/mobile-contact-sheet.jpg)  | [Contact sheet](after/mobile-contact-sheet.jpg)  |

## Image pairs

| View                       | Desktop before                                          | Desktop after                                         | Mobile before                                          | Mobile after                                         |
| -------------------------- | ------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| account                    | [Before](before/account-desktop.png)                    | [After](after/account-desktop.png)                    | [Before](before/account-mobile.png)                    | [After](after/account-mobile.png)                    |
| account-notifications      | [Before](before/account-notifications-desktop.png)      | [After](after/account-notifications-desktop.png)      | [Before](before/account-notifications-mobile.png)      | [After](after/account-notifications-mobile.png)      |
| admin                      | [Before](before/admin-desktop.png)                      | [After](after/admin-desktop.png)                      | [Before](before/admin-mobile.png)                      | [After](after/admin-mobile.png)                      |
| demo-api-tokens            | [Before](before/demo-api-tokens-desktop.png)            | [After](after/demo-api-tokens-desktop.png)            | [Before](before/demo-api-tokens-mobile.png)            | [After](after/demo-api-tokens-mobile.png)            |
| demo-assistant             | [Before](before/demo-assistant-desktop.png)             | [After](after/demo-assistant-desktop.png)             | [Before](before/demo-assistant-mobile.png)             | [After](after/demo-assistant-mobile.png)             |
| demo-audit                 | [Before](before/demo-audit-desktop.png)                 | [After](after/demo-audit-desktop.png)                 | [Before](before/demo-audit-mobile.png)                 | [After](after/demo-audit-mobile.png)                 |
| demo-billing               | [Before](before/demo-billing-desktop.png)               | [After](after/demo-billing-desktop.png)               | [Before](before/demo-billing-mobile.png)               | [After](after/demo-billing-mobile.png)               |
| demo-exports               | [Before](before/demo-exports-desktop.png)               | [After](after/demo-exports-desktop.png)               | [Before](before/demo-exports-mobile.png)               | [After](after/demo-exports-mobile.png)               |
| demo-invitations           | [Before](before/demo-invitations-desktop.png)           | [After](after/demo-invitations-desktop.png)           | [Before](before/demo-invitations-mobile.png)           | [After](after/demo-invitations-mobile.png)           |
| demo-member-delivery       | [Before](before/demo-member-delivery-desktop.png)       | [After](after/demo-member-delivery-desktop.png)       | [Before](before/demo-member-delivery-mobile.png)       | [After](after/demo-member-delivery-mobile.png)       |
| demo-members               | [Before](before/demo-members-desktop.png)               | [After](after/demo-members-desktop.png)               | [Before](before/demo-members-mobile.png)               | [After](after/demo-members-mobile.png)               |
| demo-notifications         | [Before](before/demo-notifications-desktop.png)         | [After](after/demo-notifications-desktop.png)         | [Before](before/demo-notifications-mobile.png)         | [After](after/demo-notifications-mobile.png)         |
| demo-overview              | [Before](before/demo-overview-desktop.png)              | [After](after/demo-overview-desktop.png)              | [Before](before/demo-overview-mobile.png)              | [After](after/demo-overview-mobile.png)              |
| demo-settings              | [Before](before/demo-settings-desktop.png)              | [After](after/demo-settings-desktop.png)              | [Before](before/demo-settings-mobile.png)              | [After](after/demo-settings-mobile.png)              |
| demo-sso                   | [Before](before/demo-sso-desktop.png)                   | [After](after/demo-sso-desktop.png)                   | [Before](before/demo-sso-mobile.png)                   | [After](after/demo-sso-mobile.png)                   |
| demo-webhook-delivery      | [Before](before/demo-webhook-delivery-desktop.png)      | [After](after/demo-webhook-delivery-desktop.png)      | [Before](before/demo-webhook-delivery-mobile.png)      | [After](after/demo-webhook-delivery-mobile.png)      |
| demo-webhooks              | [Before](before/demo-webhooks-desktop.png)              | [After](after/demo-webhooks-desktop.png)              | [Before](before/demo-webhooks-mobile.png)              | [After](after/demo-webhooks-mobile.png)              |
| public-preview             | [Before](before/public-preview-desktop.png)             | [After](after/public-preview-desktop.png)             | [Before](before/public-preview-mobile.png)             | [After](after/public-preview-mobile.png)             |
| workspace-api-tokens       | [Before](before/workspace-api-tokens-desktop.png)       | [After](after/workspace-api-tokens-desktop.png)       | [Before](before/workspace-api-tokens-mobile.png)       | [After](after/workspace-api-tokens-mobile.png)       |
| workspace-assistant        | [Before](before/workspace-assistant-desktop.png)        | [After](after/workspace-assistant-desktop.png)        | [Before](before/workspace-assistant-mobile.png)        | [After](after/workspace-assistant-mobile.png)        |
| workspace-audit            | [Before](before/workspace-audit-desktop.png)            | [After](after/workspace-audit-desktop.png)            | [Before](before/workspace-audit-mobile.png)            | [After](after/workspace-audit-mobile.png)            |
| workspace-billing          | [Before](before/workspace-billing-desktop.png)          | [After](after/workspace-billing-desktop.png)          | [Before](before/workspace-billing-mobile.png)          | [After](after/workspace-billing-mobile.png)          |
| workspace-exports          | [Before](before/workspace-exports-desktop.png)          | [After](after/workspace-exports-desktop.png)          | [Before](before/workspace-exports-mobile.png)          | [After](after/workspace-exports-mobile.png)          |
| workspace-forbidden        | [Before](before/workspace-forbidden-desktop.png)        | [After](after/workspace-forbidden-desktop.png)        | [Before](before/workspace-forbidden-mobile.png)        | [After](after/workspace-forbidden-mobile.png)        |
| workspace-invitations      | [Before](before/workspace-invitations-desktop.png)      | [After](after/workspace-invitations-desktop.png)      | [Before](before/workspace-invitations-mobile.png)      | [After](after/workspace-invitations-mobile.png)      |
| workspace-member-delivery  | [Before](before/workspace-member-delivery-desktop.png)  | [After](after/workspace-member-delivery-desktop.png)  | [Before](before/workspace-member-delivery-mobile.png)  | [After](after/workspace-member-delivery-mobile.png)  |
| workspace-members          | [Before](before/workspace-members-desktop.png)          | [After](after/workspace-members-desktop.png)          | [Before](before/workspace-members-mobile.png)          | [After](after/workspace-members-mobile.png)          |
| workspace-overview         | [Before](before/workspace-overview-desktop.png)         | [After](after/workspace-overview-desktop.png)         | [Before](before/workspace-overview-mobile.png)         | [After](after/workspace-overview-mobile.png)         |
| workspace-picker           | [Before](before/workspace-picker-desktop.png)           | [After](after/workspace-picker-desktop.png)           | [Before](before/workspace-picker-mobile.png)           | [After](after/workspace-picker-mobile.png)           |
| workspace-settings         | [Before](before/workspace-settings-desktop.png)         | [After](after/workspace-settings-desktop.png)         | [Before](before/workspace-settings-mobile.png)         | [After](after/workspace-settings-mobile.png)         |
| workspace-sso              | [Before](before/workspace-sso-desktop.png)              | [After](after/workspace-sso-desktop.png)              | [Before](before/workspace-sso-mobile.png)              | [After](after/workspace-sso-mobile.png)              |
| workspace-suspended        | [Before](before/workspace-suspended-desktop.png)        | [After](after/workspace-suspended-desktop.png)        | [Before](before/workspace-suspended-mobile.png)        | [After](after/workspace-suspended-mobile.png)        |
| workspace-webhook-delivery | [Before](before/workspace-webhook-delivery-desktop.png) | [After](after/workspace-webhook-delivery-desktop.png) | [Before](before/workspace-webhook-delivery-mobile.png) | [After](after/workspace-webhook-delivery-mobile.png) |
| workspace-webhooks         | [Before](before/workspace-webhooks-desktop.png)         | [After](after/workspace-webhooks-desktop.png)         | [Before](before/workspace-webhooks-mobile.png)         | [After](after/workspace-webhooks-mobile.png)         |

## Setup sheet comparisons

The original baseline displayed the checklist inline on the overview. These pairs deliberately compare that original overview with the newly opened setup sheet; there was no baseline drawer state. The ordinary overview pairs above show the new closed state.

| Workspace | Desktop before, inline                          | Desktop after, sheet open                       | Mobile before, inline                          | Mobile after, sheet open                       |
| --------- | ----------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| Demo      | [Before](before/demo-overview-desktop.png)      | [After](after/demo-setup-open-desktop.png)      | [Before](before/demo-overview-mobile.png)      | [After](after/demo-setup-open-mobile.png)      |
| Signed in | [Before](before/workspace-overview-desktop.png) | [After](after/workspace-setup-open-desktop.png) | [Before](before/workspace-overview-mobile.png) | [After](after/workspace-setup-open-mobile.png) |
