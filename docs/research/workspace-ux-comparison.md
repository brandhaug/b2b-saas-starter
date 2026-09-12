# Workspace UX comparison

Pre-implementation assessment, reviewed 2026-09-12. The workspace has a coherent visual identity and useful operational patterns. Its largest gap against the selected references is efficiency when users have more than a few records or need to complete a task across pages.

## Evidence and scope

Independent source assessment: `/root/design_review`. Independent static assessment: `/root/detector`, held until the design assessment finished. Parent inspected the current checkout's demo at localhost:3101, including desktop overview, members and billing, and members at 390 × 844. The demo shares page components but has separate shell behavior and refuses mutations. Authenticated mutations, competitor private accounts, rendered contrast, performance and complete keyboard paths were not tested.

Competitor behavior is sourced in [Workspace UX benchmarks](workspace-ux-benchmarks.md). These references are useful examples, not an empirical product ranking. Recommendations below are design judgments.

## What to preserve

- Catppuccin Mocha, Geist, restrained accents and consistent component treatments suit the engineer audience.
- The overview already prioritizes attention items over decorative metrics.
- Permission-aware navigation, targeted action failures, named success feedback, destructive confirmations and one-time secret reveal are meaningful strengths.
- Audit already has URL-backed filters, pagination and a detail sheet. Use this existing pattern to improve other lists.
- Command search, onboarding, responsive navigation and support already exist. Improve their relevance rather than adding duplicate systems.

## Comparison and recommendations

| Area                     | Current implementation                                                                                                                      | Reference pattern                                                                                                     | Recommendation                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Navigation               | Overview, Members, Assistant, General, Billing and Audit trail sit together; developer tools have a separate group.                         | Stripe separates personal, account and product settings; Linear exposes workspace settings through workspace context. | Rename General to Settings immediately. Group administration more clearly. A full settings sub-navigation becomes useful as configuration grows. Keep developer tools prominent for this starter's audience.                                           |
| Page layout              | Every authenticated page has a 896px maximum body width and 256px desktop sidebar.                                                          | Operational search and list workflows in the references expose comparable records and relevant controls.              | Keep forms narrow; give member, audit and delivery lists fluid width. This layout recommendation is our judgment, not a measured competitor width comparison.                                                                                          |
| Visual hierarchy         | Page heading, tabs, panel heading, panel description and individually bordered rows repeatedly surround the same subject.                   | Linear's member management separates member attributes from row actions.                                              | Reduce nested containers and repeated labels. Align comparable attributes into columns. Preserve the existing colors and typeface.                                                                                                                     |
| Members                  | Full-array card list; each eligible row exposes two role changes and removal. Invitations sit below the roster.                             | Linear has role/status filters, row menus and multi-email invitations.                                                | Search name/email; filter role and status; use aligned rows and contextual actions. Place Invite member in the page header so it remains discoverable with a large roster. Keep explicit confirmations for removal and consequential role changes.     |
| Search                   | Public pages and Knowledge precede Workspace; workspace results navigate to pages.                                                          | Linear commands act on selected objects; Stripe searches actual resources and supports shareable search URLs.         | Prioritize current-workspace actions and destinations. Add authorized Invite member, Create token and Register endpoint commands, then member/resource lookup when justified.                                                                          |
| Overview                 | Attention feed, notifications, then onboarding. Pending invitations are warnings regardless of age. Attention links land on whole pages.    | Stripe surfaces unresolved work; Slack Activity offers actionable filters.                                            | Distinguish normal pending work from failure. Link to the relevant invitation, token or delivery. Show a calm healthy state when nothing needs intervention. Keep chronological history separate from tasks needing action.                            |
| Settings                 | Sidebar General opens Workspace settings with a General tab, SSO and exports. Tabs use default local state.                                 | Stripe groups settings by scope; Stripe search preserves state in URLs.                                               | Use clear labels and URL-backed tabs. Reloading or sharing a link should preserve SSO, export and delivery context.                                                                                                                                    |
| Billing                  | Current plan and plan catalog; inactive-provider notice exposes environment variable names.                                                 | Notion exposes upcoming invoices; Vercel connects usage to periods and explains spending-control consequences.        | When provider data exists, lead with plan, seats, billing period, next charge and management action. In preview, show a concise inactive state with a separate developer setup link. Do not fabricate amounts or add metering just to resemble Vercel. |
| Onboarding               | Checklist covers several independent capabilities and appears after notifications.                                                          | Linear distinguishes administrators from users joining a team.                                                        | Give evaluators one complete demonstration path. For example: create token, make a request, inspect audit evidence. New members need orientation; owners need setup. Optional integrations should remain optional.                                     |
| Mobile                   | 390px member page has no horizontal overflow, but repeated headings, preview banner and large cards leave roughly two member cards visible. | No competitor mobile inspection was performed.                                                                        | Use compact identity rows with an explicit role and action menu. Keep touch targets large. Allow enough space for email wrapping without making every action permanently visible.                                                                      |
| Permissions and recovery | Unreadable sections are absent; denied actions provide reasons.                                                                             | Notion lets users request member addition when they cannot invite.                                                    | Preserve current gates. Explain who can help at the point of refusal. Only add request workflows if the app will actually process them.                                                                                                                |

## Concrete code evidence

- `apps/web/src/components/workspace-shell.tsx`: shared width and sidebar constraints.
- `apps/web/src/lib/workspace-nav.tsx`: current navigation groups and General label.
- `apps/web/src/components/members-panel.tsx`, `role-change-buttons.tsx`: member cards and repeated foreground actions.
- `apps/web/src/components/api-tokens-panel.tsx`, `webhooks-panel.tsx`: similarly unfiltered resource lists.
- `apps/web/src/components/command-palette-dialog.tsx`: public/knowledge/workspace ordering and navigation-only workspace entries.
- `apps/web/src/components/page/section-tabs.tsx`: local default tab state.
- `apps/web/src/components/workspace-audit-page.tsx`: existing URL filters, pagination and details pattern worth reusing.
- `apps/web/src/components/workspace-dashboard-page.tsx`, `onboarding-checklist.tsx`: attention and setup ordering.
- `apps/web/src/lib/attention.ts`: pending invitations always warn; endpoint rate compared with 95.
- `apps/web/src/lib/demo-fixtures.ts`: endpoint rates 0.96 and 0.8. The displayed 0.96% warning is inconsistent with the percentage scale expected by the attention logic. Align fixture units before judging endpoint health presentation.

## Order of work

1. Correct demo percentage units, rename General, reduce false urgency, and prioritize workspace search entries.
2. Make Members the reference for list design: page-header invitation action, search/filter toolbar, aligned rows and contextual actions. Check it with 50 representative records and long names/emails.
3. Apply that list pattern to tokens and webhooks. Let operational pages use more width.
4. Persist tabs and investigation context in URLs. Make attention links open the relevant record or filtered view.
5. Refine role-specific onboarding and provider-aware billing summaries.

Do not add favorites, configurable dashboards, bulk operations everywhere, realtime collaboration, or a new design theme without a demonstrated task. These products have domain objects and scale that the starter does not yet need.

## Assessment notes

Provisional source-based Nielsen scores: status 3, real-world match 3, control 3, consistency 3, error prevention 3, recognition 3, efficiency 2, minimalism 2, recovery 3, help 3. Total 28/40. These are reviewer judgments, not usability measurements.

Static detector returned zero findings for `apps/web/src/components`. Its TSX regex scan does not assess task quality, rendered contrast or usability. No browser overlay was injected. Target slug: `apps-web-src-components-workspace-shell-tsx`. No prior critique findings were used as assessment input. Temporary browser captures and logs were kept outside the repository. The initial port 3071 page was inconsistent with this checkout and excluded; all visual judgments above use the isolated current-checkout server. Temporary servers and isolated browser were stopped after inspection.

Questions skipped: the comparison and next-step priorities can be delivered without a design approval decision. No application code changed.
