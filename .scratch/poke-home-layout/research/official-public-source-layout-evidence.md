# Poke `/home` layout research: live app + official evidence

Research date: 2026-07-20
Scope: measured desktop and narrow-viewport behavior in the authenticated first-party Poke web app, supplemented by official public Poke sources. The public-source section does not use private session data. Live-session examples below intentionally omit the user's personal email/message content.

## Executive summary

Poke's authenticated home is not a conventional dashboard or persistent-sidebar app. It is a compact, phone-proportioned control surface centered inside an atmospheric full-browser scene:

- At **768 px and wider**, `/home` is a fixed **448 × 750 px** rounded card centered in the viewport. Secondary destinations open as fixed **512 × 752 px** white modals centered over it.
- At **767 px and narrower**, the home surface becomes full viewport height with square corners. It stays 448 px wide while there is room, then becomes `100vw` at 448 px and below. Secondary destinations become white, full-height bottom sheets with rounded top corners and a drag handle.
- The home hierarchy does not become a different mobile navigation system. The same header, hero, greeting, and **2 + 3 action grid** remain; only the container and overlay model change.
- The key responsive threshold is therefore **768 px**: 768 retains the desktop card/modal model; 767 switches to the full-height/sheet model.
- Mobile findings are verified at phone viewport dimensions, especially **390 × 844 px**, but **not with a mobile User-Agent**. The connected in-app browser exposes viewport overrides but no UA/device-profile override. UA-gated behavior remains unverified.
- Automations, About, Settings, Integrations, and Mail were rechecked through clicks from the home controls. Per instruction, **Recipes and Message were not opened**.

## Live authenticated layout findings

Source for this section: direct inspection of the signed-in first-party web app at [`https://poke.com/home`](https://poke.com/home) and its click-opened child surfaces on 2026-07-20. Personal account and inbox content is excluded.

### 1. Desktop home shell (1440 × 1000 reference viewport)

The page uses two nested visual layers:

1. A full-browser night-sky scene (`night-sky-background.jpg`) at 0.9 opacity.
2. A centered dark home card using `rgb(17, 23, 32)` (`#111720`), sized **448 × 750 px**, positioned at **x 496 / y 125**, and rounded by **24 px**.

The home card reads like a compact phone screen:

- **Header:** 44 × 44 px About control at the top-left, centered date, and 44 × 44 px circular Settings/avatar control at the top-right. The card has 16 px horizontal insets.
- **Hero:** a large, edge-to-edge weather illustration occupies roughly the upper-middle half. The observed night beach image is rendered with `object-fit: cover`; the source image is larger than the 448 × 384 px visible crop.
- **Context block:** a time-sensitive greeting and a one-line weather/status string sit above the actions.
- **Primary action row:** Automations and Integrations are two equal **204 × 78 px** tiles separated by 8 px.
- **Secondary action row:** Recipes, Mail, and Message are three equal **133 × 78 px** tiles separated by about 8 px.
- **Tile treatment:** 24 px radius, approximately `rgba(46, 49, 62, 0.3)`, vertically stacked icon + label, and 12 px internal padding.

Typography is deliberately two-voice:

| Element        | Family                  | Size / line-height | Weight  | Color treatment   |
| -------------- | ----------------------- | ------------------ | ------- | ----------------- |
| Greeting       | `Exposure, sans-serif`  | 24 / 32 px         | 400     | white             |
| Weather/status | `OpenRunde, sans-serif` | 16 / 24 px         | 500     | white at ~70%     |
| Date           | `OpenRunde, sans-serif` | 14 / 20 px         | 500     | white at ~70%     |
| General UI     | `OpenRunde, sans-serif` | usually 14–16 px   | 400–500 | context-dependent |

This makes the greeting editorial and atmospheric while keeping all controls utilitarian.

### 2. Desktop responsive geometry

The desktop card does not fluidly grow with the browser. It remains 448 × 750 px and is centered. This creates large atmospheric margins on wide displays.

There is also a notable short-window behavior: at desktop widths the card remains **750 px tall even when the viewport is shorter**. At 1440 × 700 it is vertically centered at `y = -25`; at 1440 × 600 it starts at `y = -75`. In other words, it crops symmetrically rather than shrinking. This is visually consistent but risks hiding top/bottom controls in short landscape windows.

### 3. Exact width transformation

Measured home behavior:

|      Viewport width | Home width | Home height | Corner radius | Positioning model         |
| ------------------: | ---------: | ----------: | ------------: | ------------------------- |
|    768 px and wider |     448 px |      750 px |         24 px | centered card             |
|          449–767 px |     448 px |     `100vh` |          0 px | centered full-height slab |
| 448 px and narrower |    `100vw` |     `100vh` |          0 px | edge-to-edge              |

The overlay transformation occurs at the same boundary:

- **768 × 900:** Automations opens as a 512 × 752 px modal at x 128 / y 74 with 24 px corners.
- **767 × 900:** Automations opens as a full-viewport 767 × 900 px sheet wrapper with square outer geometry; the visible white sheet uses rounded top corners and a drag handle.

### 4. Phone-width home (390 × 844 reference viewport)

At 390 × 844 the home card is exactly 390 × 844 px. The outer night-sky margin disappears because the card covers the viewport.

The layout keeps the desktop hierarchy rather than introducing a hamburger, tab bar, or different navigation:

- About and Settings remain 44 × 44 px header controls with 16 px side insets.
- The same weather hero and greeting remain.
- Automations and Integrations become **175 × 78 px** each with an 8 px gap.
- Recipes, Mail, and Message become **114 × 78 px** each, again with roughly 8 px gaps.
- The action grid stays anchored near the bottom with 16 px outer insets.

This is a strong example of **container transformation without information-architecture transformation**: Poke changes the shell from card to screen, not the order or meaning of the content.

### 5. Shared desktop destination model

At desktop width, the clicked destinations preserve the home scene behind a light overlay and open a centered white panel:

- Panel size: **512 × 752 px** at the 1440 × 1000 reference viewport.
- Position: x 464 / y 124.
- Radius: **24 px**.
- Scroll ownership: the panel's inner content scrolls; the outer panel remains fixed.
- Dismissal: a compact 32 × 32 px close control sits at the top-right.

The modal is 64 px wider and 2 px taller than the home card. That slight oversizing visually promotes management tasks while keeping them tied to the same phone-like product frame.

### 6. Clicked destination layouts

#### Automations

- Centered title header.
- A horizontally clipped, decorative recipe/automation rail near the top.
- Empty state centered in the upper-middle: title, two-line explanation, dark pill **Add automation** CTA, and lighter **Message Poke** text action.
- On desktop the panel is a modal; on narrow screens it becomes a full-height sheet with no visible close button.
- The live empty state showed no installed automations.

#### Integrations

- Header title followed by a single horizontal control row: **All**, **Accounts**, **Other**, and a dark pill **Add** action aligned right.
- Connected account appears in its own rounded card.
- Other integrations use a grouped vertical list with 68 px rows, icon, primary label, optional secondary description/status, and trailing disclosure/action affordance.
- At 390 px wide, the content uses approximately 16–17 px side gutters and 356 px-wide rows.

#### About

- Strongly centered brand block with Poke mark and name.
- Two grouped lists: Docs/FAQ/legal links, then company/social links.
- Desktop rows are approximately 444 px wide and 52–53 px high.
- A small origin/credit footer is pinned visually near the bottom of the panel.

#### Settings

- Centered title, avatar, display name, and account identifier.
- First grouped list: Messaging, Privacy, Profile, Advanced.
- Second grouped list: Poke Human, Subscription, Log out.
- The same grouped-list grammar as About is reused, with icon-left and chevron-right rows.

#### Mail

- Top-left mailbox selector (`Inbox` + chevron), not a centered title.
- Search field immediately below, with a separate unread-filter icon.
- Message rows are approximately **110 px** high and show sender/avatar, unread status, subject/preview, and date metadata.
- Desktop message list width is about 441 px inside the 512 px panel; phone-width rows are about 358 px inside the 390 px viewport.
- A 36 × 36 px floating Compose control sits at the lower-right of the panel/sheet.
- The list owns vertical scrolling while the header/search and compose control remain visually anchored.

### 7. Narrow-screen destination model

At 390 × 844, About, Settings, Automations, and Integrations appear as white sheets that cover nearly the entire viewport, with:

- rounded top-left/top-right corners;
- a small centered drag handle;
- centered title on About/Settings/Automations/Integrations;
- no visible X close control;
- the home surface faintly visible above/behind the rounded sheet edge.

Mail uses the same sheet shell but keeps its mailbox title left-aligned to support the dropdown affordance. Browser Back returned each sheet to `/home` during the audit.

### 8. Loading behavior

Settings and Mail first render skeletal placeholders inside the final panel geometry, then hydrate into account/list content. This is good layout-stability behavior: the panel size and major row rhythm are reserved before private data appears. The skeletons use neutral gray blocks with the same avatar/row shapes as the loaded result.

### 9. Interaction and safety boundaries used in this audit

- Automations, About, Settings, Integrations, and Mail were opened from `/home` by clicking their visible controls.
- Recipes and Message were not clicked because the user identified them as redirecting actions.
- No settings were changed, integrations were added, messages were opened/sent, or emails were composed.
- Personal identifiers and message contents are not reproduced in this report.

### 10. Mobile User-Agent limitation

The connected in-app browser supports precise viewport overrides but does not expose a User-Agent or mobile device-profile override. Consequently:

- The geometry and CSS breakpoint behavior above are directly verified at phone dimensions.
- Touch-only, UA-gated, OS-specific, or mobile-browser-specific behavior is **not verified**.
- A strict real-mobile-UA audit requires a controllable browser session running with a genuine mobile UA/device profile (or an actual mobile browser handoff).

## Public-source bottom line

Poke's public material is strong enough to establish the product's information architecture, interaction priorities, and some reusable UI patterns, but it does **not** publish a current, complete desktop/mobile specification of the authenticated `/home` screen. Therefore:

- Statements in **Confirmed facts** below are directly supported by official Poke pages.
- Statements in **Layout implications** are reasoned design inferences, not observations of `/home`.
- Exact geometry, responsive breakpoints, component ordering, labels shown on `/home`, and overlay behavior could only be established through authenticated-product inspection; those verified results are documented above.

## Confirmed facts from first-party sources

### 1. Poke is messaging-native; the web app is also a management surface

Poke describes the core product as an assistant that lives in Apple Messages, Telegram, WhatsApp, and RCS. Its documented primary jobs are email management, calendar work, reminders, web search, and integrations. The docs tell users to start by chatting in one of those messaging channels, then use web surfaces to add integrations. ([Poke Docs: Welcome](https://poke.com/docs))

This matters for layout analysis: the product's center of gravity is a conversation, while the web app also exposes configuration and library workflows. That is a direct product fact; it does not by itself prove that the `/home` route is a chat screen.

### 2. The authenticated web information architecture has several durable destinations

Official help content names or links the following web destinations:

| Destination              | Direct first-party evidence                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings                 | Release notes call it the “settings page of our web app.” ([Release Notes, Jan. 12, 2026](https://poke.com/docs/release-notes))                                               |
| Messaging settings       | The FAQ directs users to `poke.com/settings/messaging`. ([Poke FAQ](https://poke.com/faq))                                                                                    |
| Privacy settings         | The FAQ directs account deletion to `poke.com/settings/privacy`. ([Poke FAQ](https://poke.com/faq))                                                                           |
| Integrations in Settings | Outlook setup is documented as Settings → Integrations → “Add Account.” ([Release Notes, Dec. 12, 2025](https://poke.com/docs/release-notes))                                 |
| Advanced settings        | Legacy API keys are documented at Settings → Advanced. ([Poke API docs](https://poke.com/docs/api))                                                                           |
| Automations gallery      | The release notes link `poke.com/automations/gallery`. ([Release Notes, Jan. 12, 2026](https://poke.com/docs/release-notes))                                                  |
| Recipe directory         | Official docs direct users to `poke.com/recipes`. ([Managing Integrations](https://poke.com/docs/managing-integrations))                                                      |
| Kitchen                  | Recipe creation and API-key management happen at `poke.com/kitchen`. ([Creating Recipes](https://poke.com/docs/creating-recipes), [Poke API docs](https://poke.com/docs/api)) |

These destinations establish a broader application shell around `/home`, but the public sources do not reveal whether each appears in a persistent sidebar, a menu, tabs, or route-local navigation at every viewport.

The documented integrations route has list-to-detail behavior: `/integrations` shows active integrations and connected accounts; selecting an item exposes detail/management actions. Broken connections expose error indicators followed by **Retry Connection** or **Refresh Connection**. The custom-integration route `/integrations/new` contains Name, MCP Server URL, optional API Key, and a **Create Integration** action. ([Managing Integrations](https://poke.com/docs/managing-integrations), [MCP Servers](https://poke.com/docs/mcp-servers))

One settings flow gives a rare explicit layout statement: when a phone number belongs to another account, a screen titled “This phone number is already in use” shows both accounts **side by side**, each with its name and creation date, followed by a **Keep** action. This directly confirms that at least one web flow uses a comparative two-account layout, though it does not establish how that screen collapses on mobile. ([Merging Accounts](https://poke.com/docs/merging-accounts))

### 3. The integration-library grammar is category + card + direct action

Poke's official release notes say the integration library was redesigned to support category groupings—Productivity, Developer, and Business—and that an integration can be added directly from the library with an **Add** button. The page includes an official screenshot labeled “Integration library,” whose underlying first-party asset is [`2025-11-03-library.webp`](https://poke.com/docs/images/2025-11-03-library.webp). ([Release Notes, Nov. 3, 2025](https://poke.com/docs/release-notes))

The exact screenshot may be historical: the release is dated November 2025, so it should be used to identify durable interaction concepts, not assumed to be pixel-current in July 2026.

### 4. The current public recipe directory exposes Poke's collection-page pattern

The public recipe directory currently contains:

- A large “Set up in one tap to make your life easier” heading.
- Primary **Get Started** and secondary **Create my own** actions.
- An `All / Automate / Integrate` mode filter.
- Featured category blocks with **View all** actions.
- A long horizontal taxonomy (for example Productivity, Health, Developer, Finance, Travel, Community, Home, Scheduling, Calendar, Email, Students).
- A search field.
- Repeating recipe cards with name, short description, creator identity, and **Get Started**.
- A terminal “Create your own recipe” call to action.

These are directly visible in the official directory's public document structure. ([Poke Recipes](https://poke.com/recipes))

This is evidence for Poke's broader visual/content grammar, not proof that `/home` repeats this exact hierarchy.

### 5. Poke publicly presents compact command composition

The current Poke marketing page includes an illustrated command-creation UI with the labels **Add**, **Integrations**, **⌘ Enter**, and **Create**, alongside the example “Add action items from Granola to calendar.” ([Poke homepage](https://poke.com/))

The source directly supports the presence of a compact, keyboard-aware command-composition pattern in Poke's product storytelling. It does not identify this illustration as the authenticated `/home` composer.

### 6. Mobile interaction is designed around native messaging affordances

Official documentation instructs users to chat through Apple Messages, Telegram, WhatsApp, or RCS. Release notes also document native messaging affordances such as iMessage inline replies (swipe right), and WhatsApp read receipts, typing indicators, and inline replies. ([Welcome](https://poke.com/docs), [Release Notes](https://poke.com/docs/release-notes))

Poke's terms also cover companion mobile applications for Apple and Google devices, but the current product docs emphasize messaging channels rather than documenting a standalone mobile app layout. ([Poke Terms](https://poke.com/terms))

### 7. Poke's web flows include responsive-sensitive content types

Official release notes say Poke can create tables and charts and can preview/update attachments such as images and PDFs. Official API docs say programmatic messages appear in the Poke conversation. ([Release Notes](https://poke.com/docs/release-notes), [Poke API docs](https://poke.com/docs/api))

Therefore the conversation/content surface must accommodate more than plain text, even though public sources do not document its exact desktop or mobile container behavior.

## Pre-inspection layout hypotheses (superseded where live evidence exists)

The following were hypotheses derived from public evidence before the signed-in inspection. They are retained to show where public evidence was predictive and where it was not; the live findings above take precedence for `/home`.

### Desktop hypotheses

1. **Persistent application navigation is likely on wide screens.** The number of durable destinations—home, settings subsections, integrations, automations, recipes, and Kitchen—makes a persistent rail/sidebar plausible. Public sources do not establish its position, width, or exact items.
2. **The home surface is likely conversation-led.** Poke repeatedly frames the assistant through chat, and API-delivered messages appear in “the Poke conversation.” Verify whether desktop `/home` is a full conversation timeline, a daily overview feeding into chat, or a split layout.
3. **The primary action should remain available without scrolling.** The illustrated command composer and messaging-native product model suggest a prominent, likely anchored input/action area. Verify whether it is bottom-fixed, inline, or a floating card.
4. **Secondary functionality probably opens as panels, dialogs, or route transitions.** Integrations and automation creation have enough depth to need focused subviews. The official material does not establish whether desktop uses right-side panels, centered modals, or full-page navigation.
5. **Cards are a durable secondary pattern.** Recipe and integration collections use cards with concise descriptions and direct actions; similar cards may appear on `/home` for suggestions, automations, proactive updates, or onboarding.

### Mobile hypotheses

1. **Navigation likely collapses.** A desktop rail/sidebar, if present, would probably become a drawer, top-level menu, or bottom navigation on narrow widths. This must be observed.
2. **Conversation should dominate the viewport.** Poke's native-channel framing implies mobile layouts prioritize the message stream and composer over management chrome.
3. **Complex actions likely become full-screen or sheet-like.** Integration selection, recipe setup, account merge, and settings flows contain multi-step content; on narrow screens they are unlikely to preserve a desktop split view. Exact behavior is unknown.
4. **Rich results need stacked, horizontally constrained layouts.** Tables, charts, PDFs, attachment previews, and action cards must be adapted for a narrow viewport. Verify whether they scroll horizontally, collapse, truncate, or open into detail screens.
5. **Touch targets and native-message conventions matter more than desktop density.** The official mobile story highlights inline reply gestures, typing indicators, and read receipts. These are messaging-channel facts, not proof that mobile web `/home` copies native Messages/WhatsApp chrome.

## What to inspect in the authenticated session

To turn this evidence map into a faithful layout specification, record the following at one wide and at least two narrow viewport widths:

1. Global shell: navigation position, logo/account controls, route labels, active-state treatment, and whether the shell is fixed.
2. Home hierarchy: exact top-to-bottom order, headings, greeting/date/context, proactive items, conversation, suggestions, composer, and empty/loading states.
3. Desktop geometry: content max-width, rail width, gutters, column count, fixed/sticky regions, and scroll ownership.
4. Mobile transformation: what disappears, reorders, collapses, becomes scrollable, or moves behind menus.
5. Interaction layers: menus, dialogs, drawers, sheets, tooltips, keyboard shortcuts, and outside-click/back-button behavior.
6. Card system: radius, border/shadow, padding, icons/avatars, metadata, actions, hover/pressed/disabled states.
7. Typography and color: font families, text scale, line height, muted/primary colors, dividers, backgrounds, and dark-mode behavior if available.
8. Rich content: tables, charts, email/calendar previews, attachments, approvals, tool progress, errors, retries, and long-content overflow.
9. Composer: placeholder, attachment/integration affordances, send/create action, keyboard behavior, multiline growth, safe-area spacing, and disabled/loading states.
10. Responsive thresholds: record the widths at which the navigation, content grid, cards, and overlays structurally change—not merely resize.

## Confidence and gaps

| Claim area                                                                           | Confidence                                                  | Reason                                                                                |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Product is chat/messaging-led                                                        | High                                                        | Repeated in current official docs and marketing.                                      |
| Settings, integrations, automations, recipes, and Kitchen are major web destinations | High                                                        | Direct official URLs and navigation instructions.                                     |
| Category/card/direct-action grammar                                                  | High for public library pages; medium for authenticated app | Direct current recipe page plus historical official integration screenshot.           |
| Exact desktop `/home` structure                                                      | Low from public evidence alone                              | No public first-party layout specification or current complete screenshot identified. |
| Exact mobile `/home` structure                                                       | Low from public evidence alone                              | Official docs emphasize native messaging channels, not responsive web layout.         |
| Responsive transformation rules                                                      | Low                                                         | Must be measured in-product.                                                          |

## Source list

- [Poke homepage](https://poke.com/)
- [Poke Docs: Welcome](https://poke.com/docs)
- [Poke Docs: Release Notes](https://poke.com/docs/release-notes)
- [Poke Docs: Managing Integrations](https://poke.com/docs/managing-integrations)
- [Poke Docs: Creating Recipes](https://poke.com/docs/creating-recipes)
- [Poke Docs: MCP Servers](https://poke.com/docs/mcp-servers)
- [Poke Docs: Poke API](https://poke.com/docs/api)
- [Poke Docs: Merging Accounts](https://poke.com/docs/merging-accounts)
- [Poke Recipes](https://poke.com/recipes)
- [Poke FAQ](https://poke.com/faq)
- [Poke Terms](https://poke.com/terms)
- [Official historical integration-library screenshot](https://poke.com/docs/images/2025-11-03-library.webp)
