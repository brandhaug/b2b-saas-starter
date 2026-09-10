# Full app Impeccable audit

Audited September 10, 2026, against commit `df4e9bc7`. The findings and scores below describe that revision. The remediation record at the end tracks the fixes made in the same branch.

## Implementation integrity verdict

**Pass, with reservations.** The system is coherent and product-specific. Domain vocabulary from CONTEXT.md holds across 1,245 message strings with no Team, Organization, Tenant, or Dashboard leakage. The English and Norwegian catalogs are at exact key parity. Calls to action are fork, clone, and inspect. There are no fabricated metrics, testimonials, or invented customers. The failures cluster in the evidence layer that the public site stakes its credibility on: a fabricated function name in the "real code from this repository" panel, a demo that shows Stripe and the assistant as configured on a site whose adjacent section promises they stay inactive, a hand-copied Seed Workspace that has drifted from the fixture that owns it, and a landing sentence advertising a blog that does not exist.

The bundled detector returned zero primary findings and zero advisories across `apps/web/src`. It did not catch any of the browser-verified defects below.

## Executive summary

**15/20, Good: address the weak dimensions. Roughly 65 findings: 1 P0, 11 P1, 30 P2, 25 P3.**

| Dimension                |     Score | Key finding                                                                     |
| ------------------------ | --------: | ------------------------------------------------------------------------------- |
| Accessibility            |       3/4 | Members denied a page get a chrome-less 500 crash page instead of a denial page |
| Performance              |       3/4 | Billing page polls every loader forever; query client runs on library defaults  |
| Responsive design        |       3/4 | Toggle primitives and bare text links are 18 to 34px tall on mobile             |
| Theming                  |       4/4 | Zero hard-coded colors in TypeScript; the favicon is the one off-palette asset  |
| Implementation integrity |       2/4 | The landing "real code" panel quotes a function that does not exist             |
| **Total**                | **15/20** | **Good**                                                                        |

Fix the permission-denial crash first. Then repair the four evidence-layer defects, the runtime data discipline (query defaults and the billing poll), and the mobile touch targets on the toggle primitives.

## Scope and evidence

Five parallel source audits covered accessibility, performance, theming, responsive behavior, and implementation integrity across `apps/web/src`, `apps/web/content`, and the `packages/i18n` catalogs. A production build measured chunk sizes. A live Chromium pass loaded 15 routes at 1280×800 and 390×844 on a local dev server (port 3072, since 3071 was held by another worktree), signed in as the seeded member and owner, and measured overflow, touch targets, heading outlines, landmarks, contrast, reduced motion, layout shift, and console output.

Measured facts that hold at the audited revision:

- No horizontal overflow on any of the 15 routes at 390px.
- Every token pair passes WCAG AA. The lowest composited text contrast was 6.96:1. Body text is 7.37:1, the primary button 9.23:1.
- `prefers-reduced-motion` reduces the landing page from 15 running animations to 0.
- Cumulative layout shift stayed under 0.01 on every route.
- Zero console errors and zero failed requests on every route.
- No single client chunk exceeds 300 kB gzipped. The landing entry graph is 291 kB gzipped.

This is a source and Chromium audit, not a WCAG conformance certificate. Safari, Firefox, screen-reader speech output, production Core Web Vitals, the Workers AI assistant, Stripe checkout, and real passkey ceremonies were not exercised.

## P0 findings

### 1. Permission denial renders as a 500 crash page

- **Location:** `apps/web/src/routes/workspaces.$workspaceSlug.api-tokens.tsx`, `apps/web/src/routes/workspaces.$workspaceSlug.webhooks.tsx`.
- **Category:** Accessibility / Implementation integrity.
- **Evidence:** Signed in as the seeded member, both routes return HTTP 500 with the heading "Something went wrong" and no header, nav, or main landmark. The audit route on the same account returns a proper 200 denial page through its `errorComponent`. [Screenshot](./impeccable-2026-09-10/member-api-tokens-500-mobile.png).
- **Impact:** A member who follows a sidebar link is stranded without navigation and told the app is broken.
- **Recommendation:** Reuse the audit route's denial component on both routes and keep the workspace shell around it.

## P1 findings

### 2. Fabricated code in the landing "real code" panel

- **Location:** `apps/web/src/components/landing/request-trace-section.tsx:134-136`.
- **Category:** Implementation integrity.
- **Evidence:** The MCP tool snippet, captioned `apps/api/src/mcp.ts`, calls `callerPrincipal(caller)`. That identifier exists nowhere in the repository. The real handler calls `requireCaller()` and `authorizeMcpOperation`. The other three snippets match their files verbatim.
- **Impact:** The section that states "every excerpt below is real code from this repository" contains an invented function on the page's most trust-critical claim.
- **Recommendation:** Quote the actual lines and add a guard test that reads each captioned file.

### 3. The demo fakes optional-provider activation

- **Location:** `apps/web/src/lib/demo-fixtures.ts:403,450`; `apps/web/src/components/demo-renderer.tsx:78`.
- **Category:** Implementation integrity.
- **Evidence:** The fixture sets Stripe and the assistant as configured, so `/demo` shows "Connected" and drops the example-price labels. The billing renderer passes no refusing ports, so the Upgrade button falls through to the live checkout server function and fails with "Something went wrong starting checkout".
- **Impact:** Violates design principle 4 on the surface the hero links to, and contradicts the demo banner's "Actions do not make changes".
- **Recommendation:** Ship the provider-light default in the fixture and thread refusing billing ports like every other demo section.

### 4. Seed Workspace hand-copied and drifted

- **Location:** `apps/web/src/lib/demo-fixtures.ts:41-62`; `apps/web/src/components/landing/request-trace-section.tsx:416-424`.
- **Category:** Implementation integrity.
- **Evidence:** The demo roster uses `ops@starter.local` where the fixture has `ops@example.com`, and omits the fixture's fourth member. The landing fallback hardcodes the workspace id, slug, name, and plan beside a docstring saying it mirrors the fixture.
- **Impact:** The public evidence surface presents a second dataset as the Seed Workspace, against project rule 8.
- **Recommendation:** Import the seed fixture from `packages/capabilities` in both files.

### 5. Landing page promises a blog that does not exist

- **Location:** `packages/i18n/messages/public/en.json`, key `public_knowledge_description`.
- **Category:** Implementation integrity.
- **Evidence:** `apps/web/content` contains only `docs/`. Five blog message keys have no consumer.
- **Recommendation:** Drop the blog clause and the dead keys, or mirror the changelog route's honest redirect.

### 6. The privileged-auth gate is served as HTTP 500

- **Location:** `apps/web/src/router.tsx` error component; the strong-authentication check in the workspace loaders.
- **Category:** Accessibility / Implementation integrity.
- **Evidence:** An authenticated but unverified owner visiting the workspace overview gets "Verify your identity" with status 500 and no landmarks. [Screenshot](./impeccable-2026-09-10/gate-verify-identity.png).
- **Recommendation:** Redirect to `/verify-authentication` with a return path instead of throwing.

### 7. Signed-in users see "Sign in" on every public page

- **Location:** `apps/web/src/components/public-layout.tsx:129`.
- **Category:** Implementation integrity.
- **Evidence:** With a valid session, the header CTA on the landing page, docs, pricing, help, and the sign-in page itself links to `/sign-in`. No public page offers a way back into the app.
- **Recommendation:** Show a workspaces link when a session exists.

### 8. Duplicated sentence in the seat-limit alert

- **Location:** `apps/web/src/components/workspace-members-page.tsx:55-64`.
- **Category:** Implementation integrity.
- **Evidence:** The `members_seat_limit` message already ends with "Upgrade the plan to cover the whole team." and the following link repeats that sentence as its label. [Screenshot](./impeccable-2026-09-10/crop-ws-members-m.png).

### 9. Both locale catalogs ship eagerly (withdrawn)

- **Location:** `packages/i18n/src/generated/messages.js`, consumed by about 120 files.
- **Category:** Performance.
- **Evidence:** The source audit inferred from the `export * as m` namespace re-export that every string in both locales rides the landing entry. The remediation pass measured the actual build: the 34 kB gzipped chunk that contains Norwegian strings is the command palette and language switcher code, not the catalog. The landing entry graph carries 239 English and 224 Norwegian strings out of 1,252, about 18 percent, and three probe builds through the repo's bundler confirmed that a single `m.key()` call pulls exactly one message. Paraglide's `message-modules` output is already the production-optimal structure.
- **Outcome:** No change. The remaining eager waste is the inactive locale's share of those strings, about 3 kB gzipped, and removing it would break client-side locale switching.

### 10. The billing page polls forever

- **Location:** `apps/web/src/components/workspace-billing-page.tsx:66-74`.
- **Category:** Performance.
- **Evidence:** A `setInterval` calls `router.invalidate()` every 30 seconds, or 10 while synchronization is pending, re-running every matched loader, in background tabs, without ever stopping.
- **Recommendation:** Poll only while pending, only while visible, and invalidate only the billing route.

### 11. The query client runs on library defaults

- **Location:** `apps/web/src/router.tsx:59`.
- **Category:** Performance.
- **Evidence:** No `defaultOptions`, so every query is stale at mount and refetches on window focus. The notifications panel discards its server-rendered payload immediately.

### 12. The favicon is off palette

- **Location:** `apps/web/public/favicon.svg`.
- **Category:** Theming.
- **Evidence:** Tailwind blue-600 and white, which the hex lint cannot see because it inspects TypeScript literals only.

## P2 findings

Grouped by dimension. Each was verified in source or in the browser.

**Accessibility**

- Active sidebar item and command palette selection are signalled by a 1.8 to 1.9:1 background tint alone (`workspace-nav.tsx:26`, `ui/command.tsx:112`). WCAG 1.4.11 and 2.4.7.
- Three `aria-label` values override visible button text without containing it (`live-notifications.tsx:218`, `members-panel.tsx:186`, `admin-user-actions.tsx:196`). WCAG 2.5.3, Level A. Two fail only in Norwegian.
- The landing "Copied" live region toggles opacity and never announces (`closing-section.tsx:64-71`).
- The docs table of contents calls `preventDefault`, so Tab continues in the list instead of the target section (`table-of-contents.tsx:28-40`).
- The skip link navigates but focus stays on the body; the main element has no `tabindex`.
- The 404 and 500 pages drop header, nav, and main landmarks.

**Responsive**

- Checkbox, radio, and switch hit areas are 32 to 34px tall below `md`.
- Fifteen or more standalone text links are 18 to 20px tall on mobile, including "Forgot your password?" and the landing demo link.
- The select trigger is 12px at every viewport and square-cornered while every other control is rounded.
- Locale-prefixed auth URLs 404 while other public routes redirect into the locale prefix. Auth paths are unprefixed by design; the demo route is the one worth aligning.

**Theming and copy**

- 10px sans prose in the webhook deliveries drawer, against the token's own contract in `index.css`.
- Mauve `primary` marks success icons in three places while `status-ok` does in two others.
- The alert dialog is the only rounded panel in the product.
- "Contact sales" shows on an unconfigured Stripe deployment while the honest `checkout_disabled` key is dead.
- 89 orphaned message keys, 23 byte-identical to live twins; 16 hardcoded English placeholders.
- Five count strings hard-code a plural noun, producing "1 uleste varsler" in Norwegian.
- "teammate" appears twice; CONTEXT.md lists it as an avoid term for Member.
- `/pricing` is unlinked, has no `head()`, and offers no action on any plan. ADR 0023 keeps the page.
- `/workspaces` offers no create action once a user has a workspace; the most prominent button is "Copy support details". [Screenshot](./impeccable-2026-09-10/crop-workspaces-m.png).
- `/help` says "Choose a contact option below" above "Support contact information is unavailable." [Screenshot](./impeccable-2026-09-10/crop-help-m.png).
- "Create a token" sits 52px above and detached from its heading; "Revoke" carries less weight than "Replace". [Screenshot](./impeccable-2026-09-10/crop-ws-tokens-d.png).
- Duplicate h1 and h2 with identical text on pricing, workspaces, api-tokens, and webhooks.

**Performance**

- The account page fires three client-only auth queries after hydration, all refetching on focus.
- The API tokens panel re-renders once per second to compute one boolean.
- Mermaid pulls 167 kB gzipped at read time for diagrams that are static at build time.
- The landing schematic animates `stroke-dashoffset` on 10 paths forever, including off-screen.

## Patterns and positive findings

Five patterns explain most findings. The showcase surfaces are held to a lower evidence bar than the authenticated app; all four integrity P1s live in the demo and the landing page. Correct strings get written and orphaned while the wrong string ships, and nothing in `pnpm run check` fails on an unreferenced key. Module-graph discipline is excellent but nothing governs timers, polling, or query staleness. Shared primitives carry the touch and type rules, while the toggle primitives and bare links never received them. Several load-bearing comments in `index.css` have gone stale.

What holds: contrast is engineered rather than asserted, and the `--input` token comment records the rejected alternatives. Reduced motion is targeted, not a blanket kill. Zero hard-coded colors in TypeScript, enforced by lint. Every heavy dependency is lazy. Skip links, labelled landmarks, titled dialogs, `scope` and `aria-sort` on tables, screen-reader alternatives for charts and the schematic, and `autocomplete` on all 24 auth inputs. The changelog route refuses to fabricate a changelog, and the legal pages say plainly that no company stands behind the starter.

## Recommended actions

1. `$impeccable harden`: error components for the api-tokens and webhooks routes, the auth gate, and landmarks on error pages.
2. `$impeccable harden`: fix the MCP snippet with a guard test, import the seed fixture into the demo, ship the provider-light demo default with refusing billing ports.
3. `$impeccable optimize`: query client defaults, billing poll, the token clock, the schematic animation.
4. `$impeccable clarify`: blog clause, seat-limit sentence, `checkout_disabled`, "teammate", plural strings, placeholders.
5. `$impeccable adapt`: 44px toggles and links, control type size, select trigger.
6. `$impeccable onboard`: signed-in header, create-workspace action, help empty state, pricing page.
7. `$impeccable polish`: selection contrast, `aria-label` supersets, live region, focus handling, favicon, dead tokens.

## Remediation record

The follow-up implementation on the same branch addresses every P0 and P1 finding except the withdrawn finding 9, and every P2 bullet except the locale-prefixed demo URL, which the recommended actions did not include. The original scores remain a record of the audited revision.

| Finding | Repair                                                                                                                                                                                                                                                                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | The api-tokens, webhooks, and audit routes share one denial component that renders inside the workspace shell with sidebar, banner, and a focusable main landmark. TanStack Router still serves any errored match as a 500 document; the component records that floor so nobody re-investigates it. |
| 2       | The landing snippets live in a data module and a test reads each captioned file to assert every quoted line exists verbatim. The MCP panel now quotes the real guard.                                                                                                                               |
| 3       | The demo fixture ships Stripe and the assistant as unconfigured, and the billing renderer receives refusing ports, so no guest action reaches a provider.                                                                                                                                           |
| 4       | Seed identity data moved to a Schema-free leaf in `packages/capabilities`, re-exported by the seed fixture. The demo roster, the landing fallback, the preview shell, and the sidebar preview all derive from it.                                                                                   |
| 5       | The blog clause and five dead blog keys are gone from both locales, along with the PRODUCT.md references.                                                                                                                                                                                           |
| 6       | The workspace parent route's `beforeLoad` reads a strong-authentication flag from the existing suspension payload and redirects owners and admins to `/verify-authentication` with a return path. Members are never asked.                                                                          |
| 7       | The root loader returns a `signedIn` flag, computed only when a session cookie is present, and the public header offers a Workspaces link in place of Sign in.                                                                                                                                      |
| 8       | The seat-limit message ends before the upgrade sentence, which the link alone now carries.                                                                                                                                                                                                          |
| 10      | The billing page polls only while synchronization is pending, skips hidden tabs, and invalidates only its own route.                                                                                                                                                                                |
| 11      | The query client sets a 30 second stale time and disables refetch on window focus.                                                                                                                                                                                                                  |
| 12      | The favicon is mauve on crust with the token names recorded beside each literal.                                                                                                                                                                                                                    |

P2 repairs: an inset mauve ring marks the active sidebar item and a lavender ring marks the highlighted command palette row; the three overriding `aria-label` values now start with their visible text in both locales; the landing copy confirmation swaps live-region content; table-of-contents links move focus to the target heading; every main landmark carries `tabindex="-1"`; the 404, 500, and verification pages render inside the public layout with a skip link; checkbox, radio, switch, and standalone links reach 44px below `md`; the select trigger matches the other controls; 10px prose in the deliveries drawer is 12px; success icons use the status hue; the alert dialog has square corners; `checkout_disabled` renders for self-serve plans on an unconfigured deployment; 87 orphaned catalog keys are deleted and `pnpm run check` now fails on an unreferenced key; 16 placeholders are catalogued; five count messages are proper plurals; "teammate" is gone; the pricing page has a title, a nav entry, and one call to action into workspace billing; the workspace picker offers a New workspace action; the help page leads with the unavailable notice when there is nothing to choose; the create actions sit beside their lists and Revoke uses the destructive treatment; the account panels and the token expiry clock stop refetching and re-rendering on a timer; the schematic pauses off-screen. Mermaid was removed from the app in the meantime, so the build-time rendering suggestion is moot.

Design-system changes made under action 7 that reach beyond individual findings: the providers section is a three-column table instead of an icon-card grid; DESIGN.md now states body text is `text-sm` at every width and only controls step up on mobile; the unused chart, sidebar-primary, micro-type, and shadow tokens are deleted; the reduced-motion rule covers the whole document instead of the marketing wrapper.

Verification: `pnpm run check` passes on the rebased head. A browser pass on the local dev server confirmed all ten smoke checks, including the denial page inside the shell, the signed-in header, the demo billing refusal path, the active-state rings, skip-link focus, 44px mobile links, zero running animations under reduced motion, and landmarks on the 404 page.
