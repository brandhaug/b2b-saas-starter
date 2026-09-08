# Full app Impeccable audit

Audited September 7, 2026, against commit `dbb17e6a`. The findings and scores below describe that revision. The remediation record at the end tracks the subsequent fixes.

## Implementation integrity verdict

**Pass for a coherent product-specific design system. Not ready to pass the technical quality gate.** The public site describes the actual starter, the demo exposes seeded workspace behavior, and the authenticated app shares semantic colors, permission checks, and panel components. The defects are in shared interaction behavior and responsive layout, rather than a missing visual identity.

The bundled detector returned two advisory findings in `components/chart-defaults.ts`, at lines 26 and 34. Both are false positives: `0.6875rem` and `0.75rem` correspond to the documented micro and small-text sizes. They are excluded from the issue count. The detector did not catch the browser-verified layout and interaction failures below.

## Executive summary

**13/20, Acceptable: significant work needed. Eleven findings: 0 P0, 6 P1, 5 P2, 0 P3.**

| Dimension                |     Score | Key finding                                                                                            |
| ------------------------ | --------: | ------------------------------------------------------------------------------------------------------ |
| Accessibility            |       2/4 | Enlarged dialog content and short-screen navigation become unreachable; pending auth labels are hidden |
| Performance              |       3/4 | Every public/auth page preloads a 132,000-byte landing-only font                                       |
| Responsive design        |       2/4 | All 22 tested pages overflow at 320px; members have an additional content-width defect                 |
| Theming                  |       4/4 | Consistent single-scheme semantic palette; intentional Mermaid color mirrors                           |
| Implementation integrity |       2/4 | Auth forms can put passwords in URLs; failed admin actions close their own error UI                    |
| **Total**                | **13/20** | **Acceptable**                                                                                         |

Fix the native auth submission first. Then fix both headers, navigation scrolling, dialog constraints, member action wrapping, and admin error handling. These shared components account for most of the observed problems.

## Scope and evidence

The audit covered the public site, documentation and blog articles, FAQ, pricing, legal/support pages, authentication, all eight workspace pages, account settings, notification preferences, and system admin. Source review also covered shared forms, tables, menus, notifications, charts, provider-gated settings, confirmation controls, and authentication link/consent states.

The main browser sweep requested 22 routes at both 1280×900 and 320×900. It completed 43 geometry measurements. The first desktop homepage navigation was interrupted by the preceding sign-in navigation; the homepage was inspected separately with agent-browser. All 22 mobile measurements completed. Additional checks used 390px width, a 400px-high navigation sheet, and a 320×256 viewport with the root text size doubled.

| Page family                                               | Desktop result                                | Result at 320px                   |
| --------------------------------------------------------- | --------------------------------------------- | --------------------------------- |
| Public, knowledge, support, auth                          | Completed measurements stayed within viewport | Header expands document to 386px  |
| Workspace overview, tokens, webhooks, settings, billing   | No document overflow                          | Header expands document to 409px  |
| Workspace members                                         | No document overflow                          | Content expands document to 457px |
| Workspace audit, assistant, account, notifications, admin | No document overflow                          | Header expands document to 352px  |

Evidence includes [route measurements](./impeccable-2026-09-07/route-measurements.json) and screenshots linked under the findings. The active local app used port 3098 with matching auth origins and the repository's seeded demo account. An initial response on port 3071 had missing assets and was excluded from visual conclusions. A billing-page CLI timeout did not recur in the Playwright runtime and is not counted as an app defect.

This is a source and Chromium audit, not a WCAG conformance certificate. Safari, Firefox, screen-reader speech output, production Core Web Vitals, and live payment/SSO/email-provider flows were not measured. Error handling for the admin confirmation was checked with its outgoing request blocked. No destructive operation or external message was sent. Performance scoring is based on the loading implementation and asset evidence, not production timing.

## P1 findings

### 1. Auth forms submit passwords into the URL before hydration

- **Location:** `apps/web/src/components/auth/auth-card-form.tsx:53` and `:91`; `apps/web/src/components/auth/auth-submit-button.tsx:46`.
- **Category:** Implementation integrity.
- **Evidence:** The form has no `method` or native submission handler. `preventDefault()` exists only in React's submit callback. The `data-hydrated` attribute helps tests wait but does not disable the rendered form. With JavaScript disabled, submitting synthetic credentials produced `/sign-in?email=audit%40example.invalid&password=audit-only-placeholder`.
- **Impact:** Slow or failed client initialization can put passwords in browser history and request URLs instead of signing the user in. The shared form also serves registration and password reset.
- **Standard:** Safe handling of credentials; this finding is not assigned a WCAG criterion.
- **Recommendation:** Prevent submission until the client handler is attached, including Enter-key submission. Define a safe native fallback that cannot serialize credentials into a GET URL. Give users an explanation if initialization fails. Verify both delayed and absent JavaScript.
- **Suggested command:** `$impeccable harden`.

### 2. Both application headers overflow narrow screens

- **Location:** `apps/web/src/components/public-layout.tsx:44`; `apps/web/src/components/workspace-shell.tsx:173`.
- **Category:** Responsive design / Accessibility.
- **Evidence:** At 320px, the public header's Sign in control ends at 386px. Workspace headers end at 409px with the notification badge, or 352px without it. Their fixed controls and gaps leave insufficient room even after the workspace name shrinks. [Public header screenshot](./impeccable-2026-09-07/header-320.png).
- **Impact:** Sign in, notifications, and the account menu are partly or entirely off-screen. The overflow appears throughout the app because the layouts are shared.
- **Standard:** WCAG 1.4.10 requires ordinary horizontal-language content to reflow at 320 CSS pixels. [W3C reflow guidance](https://www.w3.org/WAI/WCAG21/Understanding/reflow).
- **Recommendation:** Give each header an explicit narrow-screen arrangement. Move secondary controls into the mobile menu, reduce the wordmark footprint, and keep account access visible. Check both languages and headers with and without notification counts.
- **Suggested command:** `$impeccable adapt`.

### 3. The mobile workspace navigation cannot scroll

- **Location:** `apps/web/src/components/workspace-shell.tsx:186–198`; `apps/web/src/components/ui/sheet.tsx:58`.
- **Category:** Responsive design / Accessibility.
- **Evidence:** At 390×400, the navigation sheet has a 400px client height and 542px scroll height, but `overflow-y: visible`. Account begins at about 450px and Support at 490px. Neither the sheet nor its content wrapper provides scrolling. [Navigation screenshot](./impeccable-2026-09-07/navigation-short.png).
- **Impact:** Users on short screens cannot reach the lower navigation destinations by touch. Larger text and the owner's longer menu make the problem worse.
- **Standard:** Content and functionality must remain available when the layout changes; assess against WCAG 1.4.10 and 1.4.4.
- **Recommendation:** Make the sheet's navigation body a constrained, independently scrollable area, with `min-height: 0` in the flex chain. Keep dismissal reachable and ensure focused links scroll into view.
- **Suggested command:** `$impeccable adapt`.

### 4. Confirmation dialogs lose content and actions with enlarged text

- **Location:** `apps/web/src/components/ui/alert-dialog.tsx:50`; `apps/web/src/components/workspace-general-settings.tsx:216`.
- **Category:** Responsive design / Accessibility.
- **Evidence:** The popup is fixed and vertically centered without a maximum viewport height or scrolling. Its action row does not wrap. At 320×256 with the root text size set to 200%, the delete-workspace dialog extends from −68.5px to 324.5px. The confirmation button ends at approximately 696px horizontally. `overflow-y` remains `visible`. [Dialog screenshot](./impeccable-2026-09-07/dialog-scaled.png).
- **Impact:** The title, warning, and confirmation controls cannot all be read or reached. This affects security and destructive-action dialogs using the shared primitive.
- **Standard:** Relevant to WCAG 1.4.4 and 1.4.10. Text enlargement must preserve content and functionality. [W3C resize-text guidance](https://www.w3.org/WAI/WCAG21/Understanding/resize-text.html).
- **Recommendation:** Constrain popup height to the available viewport, allow internal scrolling, retain a viewport gutter, and stack or wrap actions on narrow screens. Let long confirmation labels wrap.
- **Suggested command:** `$impeccable adapt`.

### 5. Failed admin confirmations hide their error message

- **Location:** `apps/web/src/components/ui/alert-dialog.tsx:89`; `apps/web/src/components/ban-user-action.tsx:61–71`; `apps/web/src/components/impersonate-user-action.tsx:71–80`.
- **Category:** Implementation integrity / Accessibility.
- **Evidence:** `AlertDialogAction` renders the primitive's `Close`, which closes immediately when clicked. Ban and impersonation render their failure only inside that popup. A blocked ban request closed the dialog and left no visible alert. The installed Base UI close handler confirms the immediate `setOpen(false)` behavior.
- **Impact:** A failed operation looks like a completed confirmation. The administrator cannot see why it failed without reopening the dialog. Pending feedback inside the popup disappears too.
- **Standard:** Error visibility and recovery; assess the final feedback design against WCAG 4.1.3 and applicable error-identification requirements.
- **Recommendation:** Use a regular action button for asynchronous confirmations and close only on success, or render persistent feedback outside the popup. Keep the pending state visible and prevent repeated submissions. Other panels already place feedback outside their closing dialogs.
- **Suggested command:** `$impeccable harden`.

### 6. Member action rows force the entire page wider

- **Location:** `apps/web/src/components/members-panel.tsx:169`; `apps/web/src/components/ui/item.tsx:161`; `apps/web/src/components/role-change-buttons.tsx:53`.
- **Category:** Responsive design / Accessibility.
- **Evidence:** The roster places a role badge, multiple role-change buttons, and Remove in a non-wrapping `ItemActions` flex row. Buttons cannot shrink. At 320px, the resulting grid minimum expands the content to 457px, including headings and the seat-limit notice. This is separate from the header overflow. [Members screenshot](./impeccable-2026-09-07/members-320.png).
- **Impact:** Users must pan the whole page to manage members or read text. Remove and role controls fall outside the viewport with normal seeded data.
- **Standard:** WCAG 1.4.10. This is a list of members and actions, not a data table requiring two-dimensional layout.
- **Recommendation:** Allow the content grid to shrink and put actions on a wrapping row, or use a per-member action menu on small screens. Check the armed removal state and both locales as well as the idle row.
- **Suggested command:** `$impeccable adapt`.

## P2 findings

### 7. The one-time-code cells cannot edit the selected digit

- **Location:** `apps/web/src/components/auth/otp-code-input.tsx:36–57`.
- **Category:** Implementation integrity.
- **Evidence:** Focusing a cell selects its contents, but single-digit input always appends to the complete value and truncates to six characters. For a filled `123456`, typing `9` into the third cell returns `123456`. Backspace removes the final digit regardless of the focused cell. This follows directly from the implementation; a live email-code exchange was not initiated.
- **Impact:** The visible cell editing behavior is misleading. Correcting a typo requires deleting the suffix or replacing the entire code.
- **Standard:** Native editing expectations; no WCAG failure asserted.
- **Recommendation:** Replace the focused digit, or use one semantic input with a six-cell visual treatment. Preserve paste, autofill, and ordinary selection behavior.
- **Suggested command:** `$impeccable harden`.

### 8. Several controls bypass the documented mobile target size

- **Location:** `apps/web/src/components/language-switcher.tsx:46`; `apps/web/src/components/locale-preferences.tsx:100`; `apps/web/src/components/workspace-shell.tsx:227` and `:373`; `apps/web/src/components/ui/select.tsx:116`.
- **Category:** Responsive design.
- **Evidence:** The language selector is 32px high, the account language control is 36px, the clickable notification badge is 22px, and mobile workspace links measure 36px. Select options use small text and padding without the 44px minimum used by dropdown-menu items.
- **Impact:** Touch targets vary noticeably between adjacent controls. Small notification and language controls are harder to activate, particularly for users with limited dexterity.
- **Standard:** The project's DESIGN.md requires 44px controls below `md`. Do not call every sub-44px target a WCAG AA failure: the 44×44 criterion in WCAG 2.1 is AAA and has exceptions. [W3C target-size guidance](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html).
- **Recommendation:** Extend the existing mobile sizing rules to native selects, navigation links, interactive badges, and select options. Check the effective clickable area rather than only the visible icon.
- **Suggested command:** `$impeccable adapt`.

### 9. Non-landing pages preload the landing display font

- **Location:** `apps/web/src/components/public-layout.tsx:31`; `apps/web/src/components/auth/auth-card-form.tsx:70`; `apps/web/src/routes/_knowledge.tsx:147`.
- **Category:** Performance.
- **Evidence:** `PublicLayout` always emits the Newsreader preload. Auth and knowledge routes use this layout even though DESIGN.md reserves Newsreader for landing-page headings. The referenced Latin font file is 132,000 bytes.
- **Impact:** Cold visits to sign-in, docs, support, and other public pages download a font they do not render, competing with useful early resources.
- **Standard:** Route-specific resource prioritization; no WCAG criterion.
- **Recommendation:** Move the display-font preload to the landing route. Keep the shared Geist preload. Confirm the request disappears on a cold non-landing visit.
- **Suggested command:** `$impeccable optimize`.

### 10. Auth pending labels are placed inside an aria-hidden spinner

- **Location:** `apps/web/src/components/auth/auth-submit-button.tsx:48`; `apps/web/src/components/ui/spinner.tsx:10`.
- **Category:** Accessibility.
- **Evidence:** The submit button keeps its original visible label and passes `submittingLabel` only as the spinner's `aria-label`. `Spinner` also has `aria-hidden="true"`; that label is therefore excluded from the accessibility tree. No replacement status is emitted by this component.
- **Impact:** Users who cannot see the spinner miss the intended processing announcement. The button becoming unavailable does not communicate the supplied status text.
- **Standard:** Relevant to programmatically exposed waiting/progress messages under WCAG 4.1.3. [W3C status-message guidance](https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html).
- **Recommendation:** Keep the spinner decorative and expose the pending message separately, for example through a stable status region. Use `aria-busy` where useful. Check actual screen-reader output after the change.
- **Suggested command:** `$impeccable harden`.

### 11. An admin empty state bypasses localization

- **Location:** `apps/web/src/components/admin-user-actions.tsx:180`.
- **Category:** Implementation integrity.
- **Evidence:** The no-memberships branch interpolates the selected name into the literal English sentence `holds no workspace memberships.` rather than a message-catalog entry.
- **Impact:** Norwegian-language administrators encounter an English result inside an otherwise translated workflow. This is a verified source-level branch, not a claim that it appeared in the seeded live view.
- **Standard:** The repository's i18n contribution rules. No independent WCAG language failure is asserted for this sentence.
- **Recommendation:** Add the complete sentence, including the name placeholder, to both catalogs and use the message function in this branch.
- **Suggested command:** `$impeccable clarify`.

## Patterns and positive findings

The repeated responsive defects come from shared shells and intrinsic minimum widths. Page-specific breakpoint patches will leave the root cause in place. The 44px mobile rule is effective in Button and dropdown-menu items, but custom controls bypass it. The error-feedback issue comes from treating an asynchronous confirmation action as a close button.

Keep these existing practices:

- Semantic palette use is consistent. Representative token pairs measure 11.34:1 for body text on the page background, 7.89:1 for muted text on cards, and 9.23:1 for primary-button text. These are token-pair calculations, not a claim that every composited state was checked.
- Skip links, named navigation, panel headings, table regions, accessible sort state, and input/error associations are already implemented.
- The chart supplies a text alternative, removes focus from its hidden visual SVG, and disables bar animation. Small endpoint counts use readable values instead of a decorative chart.
- Hero motion and overlay entrance animations respect reduced-motion preferences. The shared spinner also stops spinning under reduced motion.
- Mermaid loading waits for viewport proximity. Telemetry and command-palette code use deferred imports. There was no verified layout-thrashing loop or broad `will-change` use in the reviewed code.
- Permission-aware sections explain unavailable actions, and the actorless demo honestly refuses mutations. Destructive actions have confirmation steps.
- Shared identifiers support wrapping. Data-table overflow is contained in named, keyboard-focusable regions.

## Recommended actions

1. **P1 — `$impeccable harden`:** Prevent native credential submission and preserve failed admin-action feedback. Address OTP editing and pending announcements in the same behavioral pass.
2. **P1 — `$impeccable adapt`:** Repair both headers, scroll the mobile navigation, constrain dialogs, and reflow member actions. Apply the documented mobile target sizes to the remaining controls.
3. **P2 — `$impeccable optimize`:** Move the Newsreader preload to the landing page.
4. **P2 — `$impeccable clarify`:** Translate the admin no-memberships state.
5. **Final finish — `$impeccable polish`:** Check the repaired layouts and interaction states together, preserving the existing palette and typography.

Run these individually, together, or in any preferred order. Re-run `$impeccable audit` after the fixes to update the score.

The context loader also reported that PRODUCT.md uses the older record format and deprecated Register section. This is tooling metadata drift, not a scored app defect. A separate Impeccable init pass can refresh it while preserving confirmed product decisions; it was left unchanged here.

## Remediation record

The follow-up implementation addresses the eleven findings above. The original scores remain a record of the audited revision.

| Finding | Repair                                                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1       | Auth forms use POST and keep credential controls disabled until hydration attaches the submit handler. A visible status explains how to recover when initialization does not finish. |
| 2       | Public and workspace headers move secondary controls into the mobile navigation and retain visible sign-in or account access at 320px.                                               |
| 3       | Mobile navigation has a constrained, scrollable body. Its lower links remain reachable on short screens.                                                                             |
| 4       | Dialogs retain viewport gutters, constrain their height, and scroll internally. Grid columns can shrink; text and footer actions wrap.                                               |
| 5       | Ban and impersonation confirmations use ordinary action buttons, retain pending and failure feedback, and close only after success.                                                  |
| 6       | Member content can shrink and its action row wraps, including the armed removal state.                                                                                               |
| 7       | OTP edits replace the focused digit. Backspace removes the relevant digit; paste and autofill remain supported.                                                                      |
| 8       | Native language controls, mobile navigation, notification links, and select options use the documented mobile target sizing.                                                         |
| 9       | The Newsreader preload belongs to the landing route. Shared public layouts no longer emit it.                                                                                        |
| 10      | Auth submit buttons expose the pending message in a separate live output and set `aria-busy`.                                                                                        |
| 11      | The admin no-memberships sentence uses a catalog message with its name placeholder in both English and Norwegian.                                                                    |

Focused component coverage exercises OTP corrections, hydration markup, pending announcements, and successful and failed admin confirmations. Browser regressions cover both public-header languages at 320px, short navigation, armed member removal, enlarged dialogs, and absent or delayed JavaScript. The enlarged-dialog check measures the popup's bounds and scroll width independently of the inert background page.

The repeated route sweep confirmed all 22 routes fit at both 1280px and 320px. The desktop docs measurement was repeated after a browser evaluation timeout. The overview required an additional repair to its attention rows, which now stack actions below readable content on mobile. See the [44 final measurements](./impeccable-2026-09-07/route-measurements-after.json).

A cold sign-in visit made no Newsreader font request; its font preloads include only Geist and Geist Mono. The landing route retains the Newsreader preload. At 320×256 with doubled text, the confirmation popup measured 254px for both client and scroll width, stayed between y=32 and y=224, and could be cancelled. See the [font and dialog measurements](./impeccable-2026-09-07/verification-after.json).

Repaired screenshots: [public header](./impeccable-2026-09-07/header-320-after.png), [overview](./impeccable-2026-09-07/overview-320-after.png), [members](./impeccable-2026-09-07/members-320-after.png), and [enlarged dialog](./impeccable-2026-09-07/dialog-scaled-after.png).

The Impeccable detector reported no findings during the main repair pass. Screen-reader speech output and Safari/Firefox behavior remain unverified.
