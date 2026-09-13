# ReUI source review

Reviewed 2026-09-13. This is technical due diligence for the app evaluation, not an adoption decision. The [design evaluation](reui-design-evaluation.md) ranks the visual improvements and includes screenshot comparisons. No application code or dependencies changed.

ReUI is a useful source of individual interaction patterns. Its stack matches this app closely, but much of its strongest table, filtering, onboarding and timeline functionality already exists here. That overlap does not rule out visual improvements. Among small component additions, a code viewer for webhook payloads, request headers and response bodies is promising. Copying the complete ReUI component would bring substantially more behavior than this use case needs.

## Evidence and scope

Read official documentation, pricing, changelog, public GitHub issues and selected source. Downloaded the repository tree and selected files at commit [`8a2c701eaf95729f238274d5ce2555a5a8bd23e7`](https://github.com/keenthemes/reui/tree/8a2c701eaf95729f238274d5ce2555a5a8bd23e7). Website documentation sometimes returned only navigation to the text browser; source inspection filled those gaps. Earlier cached single-file Filters source is stale relative to the live tree, which now splits Filters across multiple files. This review does not treat that cached file as current implementation evidence.

The accompanying app evaluation covers visual comparisons. This source review did not execute imported components, run an accessibility audit, measure bundles or verify Cloudflare deployment. Compatibility below is an inference from inspected versions and source, not a successful installation result.

## Licensing and cost

The fixed-commit [repository license](https://github.com/keenthemes/reui/blob/8a2c701eaf95729f238274d5ce2555a5a8bd23e7/LICENSE.md) is MIT, copyright Keenthemes Inc, 2025. It permits modification and redistribution with preservation of its copyright and permission notice. Preserve that notice and record the source commit for any copied repository code.

The live [website license](https://reui.io/legal/license), inspected in the browser by the main evaluation, was updated September 8, 2026. It restricts public repository distribution, redistribution of modified source and competing templates. Its broad wording about authored or composed source creates tension with the public repository's MIT license. Do not assume every item marked free on the website is suitable for redistribution in this starter. Use identifiable MIT-covered repository files, retaining their notices; keep paid website code out of this public starter unless the rights for this use are explicitly resolved.

The [pricing page](https://reui.io/pricing) lists free components, personal Pro at USD 249 and personal Ultimate at USD 499, both paid plans as one-time purchases. Pro includes blocks; Ultimate adds icons and templates. These are the personal one-seat prices, not prices for all team tiers. There is no reason to purchase either for the incremental improvements recommended here.

The [registry documentation](https://reui.io/docs/registry) distinguishes public `c-*` examples and supporting components from paid blocks, icons and templates requiring a license key. Installation adds source and registry dependencies to the project. That makes each adopted file our maintenance responsibility; upstream fixes will not arrive as a normal runtime-package upgrade.

## Technical fit

| Concern                 | Verified evidence                                                                                             | Judgment for this app                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| React and UI foundation | ReUI's current manifest uses React 19.2.7 and Base UI 1.5.0. This app pins React 19.2.8 and Base UI 1.8.0.    | Use the Base UI variant. No Radix migration is justified.                                                                                       |
| Tailwind and styling    | ReUI uses Tailwind 4 and supports Lyra. Local `components.json` selects `base-lyra`; local Tailwind is 4.3.3. | Preserve local tokens, typography and component APIs. Similar names do not guarantee identical props.                                           |
| Tables                  | ReUI declares TanStack Table `^9.0.0`; local catalog pins 9.2.3.                                              | Major versions align. Adapt small examples to the existing table abstraction rather than importing another table system.                        |
| Routing                 | ReUI's website uses Next.js; this app uses TanStack Start.                                                    | Individual React views are plausible candidates. Next-specific routing and image imports require replacement wherever an example contains them. |
| Forms                   | ReUI's website declares React Hook Form and Zod; this app uses TanStack Form and Effect.                      | Copy arrangement and interaction ideas, retain existing validation and application behavior.                                                    |
| Optional functionality  | ReUI's full website includes Shiki, drag-and-drop libraries, charts, date tools and virtualization.           | Its website manifest is not the dependency list of each component. Inspect the chosen registry item's imports before adding anything.           |

Version evidence comes from the [ReUI manifest](https://github.com/keenthemes/reui/blob/8a2c701eaf95729f238274d5ce2555a5a8bd23e7/package.json), [foundation documentation](https://reui.io/docs), local [workspace catalog](../../pnpm-workspace.yaml), [web manifest](../../apps/web/package.json) and [shadcn configuration](../../apps/web/components.json).

## Components worth examining

| Candidate                                                   | Useful part to borrow                                                                              | Scope recommendation                                                                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Code Block](https://reui.io/components/code-block)         | A labeled header with copy, wrap and expand controls makes long diagnostic JSON easier to inspect. | Highest-value small experiment for existing payload and header viewers. Keep a semantic `pre`/`code` body and use local buttons.                   |
| [Data Grid](https://reui.io/docs/components/base/data-grid) | Column menus, selection feedback and server pagination examples offer focused comparison material. | Existing URL-backed filters, sorting and column controls reduce the value of a wholesale replacement. Add only a demonstrated missing interaction. |
| [Filters](https://reui.io/docs/components/base/filters)     | Compact field/operator/value presentation can improve the existing filter editor.                  | Keep this app's All/Any semantics, URL state and query contracts. A second filter engine creates more integration work than benefit.               |
| [Timeline](https://reui.io/docs/components/base/timeline)   | Clear separation of timestamp, status and event content.                                           | Polish current delivery history where needed. Do not import step-based completion state for an append-only event history.                          |
| [Stepper](https://reui.io/docs/components/base/stepper)     | Orientation and progress indication for a truly sequential flow.                                   | The existing onboarding checklist need not become a wizard. Use only if a real sequence appears.                                                   |

These are judgments about fit, not claims that each existing page is deficient. Calendar, Gantt, Kanban, trees, ratings and commerce examples have no demonstrated starter use case. The [catalog](https://reui.io/docs) establishes their availability, not a reason to add them.

## Code Block deserves a smaller adaptation

The inspected [Code Block documentation](https://github.com/keenthemes/reui/blob/8a2c701eaf95729f238274d5ce2555a5a8bd23e7/content/docs/%28components%29/base/code-block.mdx) describes Shiki as its only new npm dependency, with lazy grammar and theme loading. Highlighting can be disabled or supplied as pre-highlighted lines. The component also supports streaming, diffs, folding and line interactions. Most of those capabilities are unrelated to a webhook payload viewer.

At the inspected commit, [the rendering file](https://github.com/keenthemes/reui/blob/8a2c701eaf95729f238274d5ce2555a5a8bd23e7/registry-reui/bases/base/reui/code-block/code-block.tsx) is 2,236 lines, while [the highlighting helper](https://github.com/keenthemes/reui/blob/8a2c701eaf95729f238274d5ce2555a5a8bd23e7/registry-reui/bases/base/reui/code-block/code-block-highlight.tsx) is 1,168 lines. These are source counts, not bundle measurements. A small local viewer with copy feedback, wrapping and expansion is a better first change. Add syntax highlighting only if users benefit from it enough to justify its loading and rendering cost.

Source inspection found useful accessibility details: a labeled focusable code region, polite status announcements, explicit copy-error handling and pressed state on wrapping. It also contains English fallbacks for fold controls, download and wrapping. Some labels are configurable, but that does not establish complete localization. Preserve the app's translated strings and check keyboard access, long-line overflow and clipboard failure in the actual composition.

## Maintenance and verification limits

The [changelog](https://reui.io/docs/changelog) records v2.5.2 on September 1, 2026, including grid localization, clipboard behavior, focus and virtualization fixes. This is evidence of active work, and also evidence that complex grid interactions are still changing. The root grid file alone is 1,115 lines before its accompanying modules. A full import would create substantial code to maintain here.

Public reports include [an unauthenticated Data Grid i18n install failing](https://github.com/keenthemes/reui/issues/129), [generated Frame styles being truncated](https://github.com/keenthemes/reui/issues/130) and [utility import mismatches](https://github.com/keenthemes/reui/issues/131). These are user reports, not failures reproduced during this evaluation. They justify inspecting the generated output and trying the exact installation in isolation before changing shared components. An old compatibility issue should not outweigh the current manifest and current source.

The inspected repository tree contained no conventional `.test.ts`, `.test.tsx`, `.spec.ts` or `.spec.tsx` files. The package scripts expose lint, typechecking and registry verification. This does not prove that ReUI has no tests elsewhere. It means this review found no public component test evidence sufficient to claim accessibility or behavior is already verified for our use.

For any later implementation, verify the actual benefit on one existing page first. Preserve permission checks and server behavior, use localized controls, check mobile widths and keyboard operation, and compare the resulting dependency and source diff before expanding adoption.
