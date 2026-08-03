# Authenticated Merchant App PWA: platform research and implementation brief

Date: 2026-07-22
Scope: `apps/merchant` only. This is research and an implementation brief; no application code was changed.

## Executive verdict

Implement `apps/merchant` as one origin-wide, installable PWA, but do **not** equate installability with offline mutation support.

The sound first release is:

1. a stable origin-wide manifest (`id`, `start_url`, and `scope` rooted at `/`);
2. `display: "standalone"` with conventional 192 px, 512 px, maskable, and Apple touch icons;
3. one responsive viewport declaration for every render;
4. edge-to-edge safe-area handling on all four sides;
5. initially, a service worker with install/activate lifecycle only and **no fetch handler**, keeping every request network-authoritative; a later, separately verified reliability phase may cache only versioned public assets and add a deliberately non-sensitive offline page;
6. update/install UI that is progressive enhancement, not a prerequisite for using the app; and
7. real-device tests for installed mode, keyboard, rotation, safe areas, expired sessions, offline state, update takeover, and external navigation.

The current app has no manifest, service worker, install lifecycle, or PWA icons. Its most urgent layout problem is the mobile-only viewport string:

```html
width=375, minimum-scale=1, shrink-to-fit=no
```

That hard-codes a minimum CSS viewport width and omits both `initial-scale=1` and `viewport-fit=cover`, while the UI already uses `100dvh` and `env(safe-area-inset-*)`. The standard responsive declaration is `width=device-width, initial-scale=1`; `viewport-fit=cover` makes edge-to-edge layout explicit and requires safe-area protection for important content. [MDN viewport reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport)

Recommended value:

```html
<meta
  name="viewport"
  content="width=device-width, initial-scale=1, viewport-fit=cover"
/>
```

Do not add `maximum-scale=1` or `user-scalable=no`. Preventing zoom blocks an important low-vision accommodation; MDN explicitly warns against it and cites WCAG scaling requirements. [MDN viewport accessibility warning](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport#usage_notes)

## What exists in the repository

`apps/merchant` is a TanStack Start SSR application deployed as a dedicated Cloudflare Worker. Vite handles its build and `apps/merchant/public` is already the correct convention for stable-name assets such as a manifest, service worker, and icons: Vite serves that directory from `/` and copies it unchanged to the output root. [Vite public-directory contract](https://vite.dev/guide/assets.html#the-public-directory)

Current relevant behavior:

- The root document injects a server-selected viewport. A phone gets `width=375, minimum-scale=1, shrink-to-fit=no`; everything else gets `width=device-width, initial-scale=1` ([`__root.tsx`](../../../apps/merchant/src/routes/__root.tsx)).
- Mobile/desktop presentation is decided from `Sec-CH-UA-Mobile` or user-agent parsing and then frozen in React state. Tablets are deliberately classified as desktop ([`merchant-presentation.ts`](../../../apps/merchant/src/lib/merchant-presentation.ts), [`merchant-presentation.tsx`](../../../apps/merchant/src/components/merchant-shell/merchant-presentation.tsx)).
- The mobile shell uses `100dvh`, fixed dialogs, `window.innerHeight` gesture distances, top/bottom safe-area values, focus restoration, inert underlays, reduced-motion styles, and overscroll containment ([`index.css`](../../../apps/merchant/src/index.css), [`mobile-shell.tsx`](../../../apps/merchant/src/components/merchant-shell/mobile/mobile-shell.tsx), [`mobile-navigation-sheet.tsx`](../../../apps/merchant/src/components/merchant-shell/mobile/mobile-navigation-sheet.tsx)).
- Theme-color metadata is created only while a mobile overlay is dimmed. There is no initial `theme-color` in server HTML ([`use-mobile-surface-chrome.ts`](../../../apps/merchant/src/components/merchant-shell/mobile/use-mobile-surface-chrome.ts)).
- Authentication is same-origin Better Auth with email verification/reset callbacks and a guarded same-origin return path. Impersonation termination intentionally navigates back to the separate Operations origin ([`auth-client.ts`](../../../apps/merchant/src/lib/auth-client.ts), [`safe-return-path.ts`](../../../apps/merchant/src/lib/safe-return-path.ts), [`__root.tsx`](../../../apps/merchant/src/routes/__root.tsx)).
- `apps/merchant/public` currently contains brand backgrounds only; there is no `manifest` link, web manifest, PWA icon set, Apple touch icon, service worker registration, offline page, install prompt, or installed-mode detection.

### Architecture-decision impact

This work is distinct from the repository's existing customer-facing Merchant PWA:

- [ADR 0051](../../../docs/adr/0051-booking-product-application-topology.md) gives the authenticated Merchant App its own `app.<domain>` origin. That makes an origin-wide `/` scope coherent and keeps it separate from public customer journeys.
- [ADR 0055](../../../docs/adr/0055-merchant-scoped-network-fresh-pwa.md) defines one `www.<domain>/:merchantSlug/` PWA per public Merchant and Booking journey. Its manifest identity, scope, and assets must not be reused for `app.<domain>`; the two products have different users, origins, and security boundaries.
- [ADR 0021](../../../docs/adr/0021-no-initial-pwa.md) explicitly excluded PWA/offline support from the authenticated starter because of caching, auth, and debugging complexity. ADR 0055 narrows it only for the public Merchant surface. Implementing an authenticated Merchant App PWA therefore requires a new ADR that narrowly supersedes ADR 0021 for **installability and installed-window presentation**, while preserving its warning against implied offline behavior.

The new ADR should state that `app.<domain>` is one PWA, that installability does not promise offline Merchant data or mutations, and that authenticated fetch caching remains excluded unless a later decision defines privacy, freshness, invalidation, account switching, and conflict semantics.

## Viewport and installed-window findings

### Replace device classification as the viewport authority

The viewport must not vary by user-agent classification. A numerical `width` is a minimum viewport width; `device-width` follows the actual device width. MDN identifies `width=device-width, initial-scale=1` as the common responsive setting and warns that fixed sizes can behave poorly on larger screens. [MDN viewport sizing](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport#viewport_width_and_screen_width)

The current `width=375` can make narrow phones render a wider coordinate space and makes the initial layout inconsistent with the real window on wider phones, landscape, split-screen tablets, desktop PWA resizing, and foldables. It is also coupled to an SSR user-agent guess that never changes after hydration. An iPad classified as desktop stays desktop in narrow split view; a desktop-installed PWA remains desktop when its window becomes phone-sized.

Use one device-width viewport for all requests. Presentation should ultimately follow available space using CSS media/container queries, with client-side state only where a genuinely different interaction model is required. If keeping the current dual trees temporarily, at minimum respond to resize/orientation changes instead of freezing the server result.

### Complete safe-area handling

`viewport-fit=cover` allows the layout viewport to fill a non-rectangular screen. Important content must then be inset. The four `safe-area-inset-*` variables define the rectangle in which content is visible. [MDN `viewport-fit`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport#usage_notes), [MDN safe-area variables](https://developer.mozilla.org/en-US/docs/Web/CSS/env#parameters)

The app already protects many top and bottom controls, which is a good base. Gaps remain:

- there is no `viewport-fit=cover`, so the intended edge-to-edge contract is absent;
- left/right safe areas are not included in full-width headers, sheets, home actions, or horizontal padding;
- the custom `--safe-area-inset-top` variable covers only the top;
- landscape devices and foldable viewport segments are not exercised; and
- `window.innerHeight` is sampled during drag animations without a resize/keyboard cancellation path.

Use four app variables with zero fallbacks and compose them with design spacing, for example `padding-inline: max(1.25rem, env(safe-area-inset-left)) max(1.25rem, env(safe-area-inset-right))`. Test—not merely emulate—portrait and landscape on notched devices.

### Keyboard and dynamic viewport

`dvh` is preferable to legacy `vh` for browser chrome changes, and the app already uses it. It does not by itself solve all virtual-keyboard behavior. The viewport meta `interactive-widget` key can request `resizes-content`, while the default is `resizes-visual`; browser support and behavior still require device testing. [MDN interactive-widget behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport#the_effect_of_interactive_ui_widgets)

Do not add `interactive-widget=overlays-content`. For forms and fixed sheets, either use `resizes-content` after verifying target browsers or listen to `window.visualViewport` to keep the focused control and sheet action row above the keyboard. Abort/recompute any active drag if the visual viewport changes. Test password managers, autofill, validation errors, hardware keyboards, and zoomed text—not just a blank software keyboard.

### Detect display mode, not device type

The manifest requests a display mode; the user agent chooses the applied mode and exposes that applied value through the `display-mode` media feature. `standalone` excludes normal navigation controls but may retain system UI such as a status bar. [Web App Manifest display-mode algorithm](https://www.w3.org/TR/appmanifest/#display-modes), [MDN `display-mode`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/display-mode)

Use `matchMedia('(display-mode: standalone)')` for installed-window adaptations. Include `navigator.standalone === true` only as an iOS fallback for supported older versions. Do not use installed mode to authorize behavior, assume screen size, or hide essential navigation. A PWA can run in a browser, and an installed desktop window can be resized.

## Manifest recommendation

Because the Merchant App owns a dedicated application origin and all its auth/recovery routes, API auth endpoint, and merchant routes live at root paths, use a single root-scoped identity:

```json
{
  "id": "/",
  "name": "BeeSolo Merchant",
  "short_name": "BeeSolo",
  "description": "Manage appointments, walk-ins, customers, services, providers, and availability.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "any",
  "theme_color": "#ffffff",
  "background_color": "#ffffff",
  "icons": [
    {
      "src": "/icons/merchant-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/merchant-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/merchant-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

Why these choices:

- `id: "/"` provides a stable app identity independent of future changes to the launch route. Without an explicit ID, Chromium derives identity from `start_url`; changing that can be interpreted as a different app. [Chrome manifest-ID guidance](https://developer.chrome.com/docs/capabilities/pwa-manifest-id)
- `start_url: "/"` lets existing server-owned onboarding, verification, session, and appointment redirects choose the correct destination. Do not launch directly into a cached appointment URL.
- `scope: "/"` keeps `/sign-in`, `/verify-email`, `/reset-password`, `/appointments/**`, `/walk-ins`, and settings inside the installed app. Manifest scope is same-origin and path-prefix based; out-of-scope documents may gain browser security UI. [Web App Manifest scope](https://www.w3.org/TR/appmanifest/#navigation-scope)
- `display: "standalone"` is the appropriate default. `fullscreen` removes more user-agent affordances and is unsuitable for an operational app. Display modes fall back when unsupported. [Web App Manifest display](https://www.w3.org/TR/appmanifest/#display-member)
- Keep orientation unrestricted. Merchants may use a mounted tablet, accessibility rotation, split screen, or a desktop window.
- Use separate `any` and `maskable` files. The manifest specification guarantees only the central circular safe zone of a maskable icon (40% radius); important logo detail must stay inside it. [Manifest icon safe zone](https://www.w3.org/TR/appmanifest/#icon-masks)

Chrome's current in-browser promotion requires HTTPS plus a manifest with a name, 192 px and 512 px icons, `start_url`, and a supported display mode; `prefer_related_applications` must be absent or false. A service worker is no longer listed as a promotion prerequisite, although it remains valuable for reliability. [Chrome install criteria](https://web.dev/articles/install-criteria)

Also add:

- `<link rel="manifest" href="/manifest.webmanifest">` with a response content type of `application/manifest+json` or compatible JSON type;
- `<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180.png">` for explicit Apple icon behavior;
- initial light/dark `theme-color` metadata in SSR HTML, using `media="(prefers-color-scheme: ...)"` where supported, before the overlay hook mutates it; and
- optionally `apple-mobile-web-app-capable=yes` as a backward-compatibility fallback only if supporting older iOS. Current WebKit recognizes `display: standalone`/`fullscreen` for Home Screen web apps. [WebKit Home Screen behavior](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

The manifest, icons, service-worker script, and any future offline fallback must be public assets: an expired or signed-out user still needs the browser to fetch installation metadata and check the worker for updates. Serve the service-worker script with revalidation-friendly/no-cache semantics, never an immutable lifetime. Register only in production-like secure contexts, and report registration/update failures to privacy-safe observability rather than silently swallowing them.

Screenshots and shortcuts are quality enhancements, not phase-one blockers:

- add authenticated, scrubbed screenshots only when they contain no real merchant/customer information; one narrow and one wide screenshot enable richer install presentation on supporting Chrome versions, and a description is recommended. [Chrome richer installation UI](https://developer.chrome.com/blog/richer-pwa-installation/)
- good shortcuts are `/appointments`, `/walk-ins`, and `/customers`; shortcut URLs must be inside manifest scope. [Web App Manifest shortcuts](https://www.w3.org/TR/appmanifest/#shortcuts-member)
- omit speculative fields such as `display_override`, `launch_handler`, `protocol_handlers`, `file_handlers`, and `share_target` until a concrete Merchant workflow requires them. Support is uneven and each adds launch/state cases.

## Service worker, offline, and cache policy

### Treat installability and offline business behavior separately

A manifest makes the app installable; a service worker is optional for installation in current Edge and Chrome guidance, but enables controlled offline behavior. [Microsoft Edge PWA guide](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/), [MDN PWA architecture](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/What_is_a_progressive_web_app)

Merchant appointments, walk-ins, availability, customers, auth state, and impersonation are mutable and sensitive. Serving a previously cached SSR response can show another signed-in user's or merchant's data after logout/account switching on a shared device. Therefore phase one should use **no service-worker `fetch` listener at all**, matching the network-fresh posture already chosen for the public PWA in ADR 0055. The browser's ordinary HTTP cache remains governed by response headers. If a later phase introduces selective service-worker caching, its allowlist should be:

| Request class                         | Initial strategy                                                     | Reason                                                                    |
| ------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| hashed JS/CSS/font assets             | cache first, versioned cache                                         | immutable build outputs                                                   |
| public brand images/icons             | stale-while-revalidate or cache first with explicit version/expiry   | non-sensitive and reusable                                                |
| document navigations                  | network only, with a static offline fallback only on network failure | SSR contains session-dependent UI/data                                    |
| `/api/auth/**`                        | network only                                                         | credentials and session transitions must be authoritative                 |
| TanStack server-function/API requests | network only                                                         | may contain merchant data even when method is GET                         |
| all non-GET requests                  | network only; never queue silently                                   | actions must not appear committed when they are not                       |
| external origins                      | pass through untouched                                               | avoid opaque responses, CSP/CORS surprises, and payment/auth interference |

The Cache API is independent of HTTP caching headers, so application routing must explicitly exclude sensitive responses. `POST` caching is inappropriate, and freshness-sensitive resources should not use cache-first. [MDN caching guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching), [Chrome caching strategies](https://developer.chrome.com/docs/workbox/caching-strategies-overview)

An offline fallback is not required for the first installable milestone and would itself require a fetch handler. If later added, it must say that live Merchant data is unavailable, preserve no customer names or appointment details, and expose **Retry**. Disable mutations while offline and keep the user's form values locally in component state where practical, without claiming they were saved. Do not add an offline outbox until the domain defines idempotency keys, conflict resolution, expiry, ordering, and user-visible delivery states.

Background Sync and Periodic Background Sync are limited/experimental across browsers, so core appointment or walk-in correctness cannot depend on them. [MDN Background Sync](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API), [MDN Periodic Background Sync](https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API)

### Update lifecycle

An updated service worker installs beside the active worker and normally waits until old controlled clients close. Browsers check for updates on in-scope navigation and functional events, with throttling rules; a byte-different script is an update. [Service worker lifecycle](https://web.dev/articles/service-worker-lifecycle)

The phase-one lifecycle-only worker has no cached runtime and cannot create an old-shell/new-assets mismatch, so it does not need a user-facing update prompt. The following rules become mandatory before a later worker caches assets or serves an offline fallback:

Recommended behavior:

1. version cache names and delete only obsolete app-owned caches during activation;
2. precache a minimal, atomic static shell/offline page, not authenticated HTML;
3. notify open clients when a worker is waiting;
4. show an accessible **Update available** action and reload only after the merchant accepts, unless there is no unsaved work;
5. do not call `skipWaiting()` blindly during an onboarding form, catalog edit, sheet gesture, or appointment action; and
6. handle `controllerchange` once to avoid reload loops.

This prevents old HTML/new chunks or in-progress mutations from being torn apart. Test a release upgrade with two open tabs/windows and a form containing unsaved input.

## Authentication, navigation, and payment boundaries

### Authentication

Same-origin email/password, email verification, and password reset fit root scope. Preserve the current sanitization of return paths and ensure emailed callbacks land on the production Merchant origin. An expired installed session should receive the normal `/sign-in?redirect=...` flow, not a cached authenticated screen.

Email links are an important platform gap: tapping verification or reset mail may open a browser tab instead of focusing the installed PWA. Correctness cannot depend on navigation capture. The link must complete safely in an ordinary browser, remain inside `app.<domain>` scope, and let a subsequent installed launch observe the verified/reset server state.

On sign-out:

- never show cached private pages;
- clear any future per-user IndexedDB/outbox state and push subscription association as the product contract requires;
- verify browser Back cannot reveal a service-worker-cached private response; and
- test signing in as a different Merchant Owner on the same OS account.

The Operations impersonation boundary is intentionally cross-origin in both directions. Starting impersonation uses a top-level cross-origin handoff/POST and the Merchant App exchanges the handoff on its own origin; ending it navigates back to the Operations App. These requests must remain network-only. The return should remain visibly external; do not widen scope or proxy it merely to preserve standalone chrome. The manifest specification treats scope as an application/security boundary, not a styling switch. [Web App Manifest navigation scope](https://www.w3.org/TR/appmanifest/#navigation-scope)

### External auth and payments

There is no external OAuth or payment flow in `apps/merchant` today, but future additions need explicit rules:

- navigate first-party steps and callback/return/error routes on the Merchant origin and within `/` scope;
- allow a payment provider or identity provider on another origin to show browser-origin UI; do not attempt to disguise it as BeeSolo;
- use normal same-context navigation unless the provider contract specifically requires a popup;
- if a popup is required, handle popup blocking, cancellation, opener loss, and returning to an expired session;
- never cache authorization codes, checkout HTML, payment status, webhook results, or callback query strings; and
- on return, re-read server-owned payment/appointment state rather than trusting URL parameters or stale cached state.

Test successful return, cancel, failure, network loss at the provider, duplicate callback, Back, app process termination, and a return after session expiry. An external URL cannot be made in-scope by service-worker registration or viewport metadata.

## Install experience

Installation should be offered after value is demonstrated—for example after onboarding and at least one successful merchant task—and remain available from Settings. Persist dismissal for a respectful cooldown.

Chromium can fire `beforeinstallprompt`, but the event is not Baseline and is unavailable in major browsers. Hide the install button until the event is actually received; use its one-shot `prompt()` only from a user action, then clear the stored event. [MDN `beforeinstallprompt`](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event)

For iOS/iPadOS, show concise Share → Add to Home Screen guidance only when:

- the platform is plausibly iOS/iPadOS;
- the app is not already in standalone mode; and
- the user requests install help or reaches the contextual promotion.

Do not claim installation can be forced. On iOS/iPadOS 26 a user can disable **Open as Web App** while adding a site, even when the site requests standalone display. [WebKit Safari 26 behavior](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/#every-site-can-be-a-web-app-on-ios-and-ipados)

Make the promotion a semantic dialog or region with keyboard focus, an explicit close action, no focus trap errors, and copy that explains the benefit. It must not obscure an appointment or walk-in action, and reduced motion must apply.

## Push, badges, and background limits

Push is a later capability, not part of the installability milestone.

iOS/iPadOS support standards-based Web Push for Home Screen web apps from 16.4. Permission must be requested directly from a user gesture. Apple also requires every received push to present a visible notification immediately; invisible pushes are unsupported and repeated violation can revoke permission. [Apple Web Push documentation](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [WebKit iOS/iPadOS Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

For Merchant notifications:

- ask in context (for example, “Notify me about new appointments”), never on first load;
- feature-detect Push, Notification, Service Worker, and Badging APIs independently;
- associate each subscription server-side with the authenticated Merchant Owner/device and revoke or detach it on sign-out;
- minimize lock-screen personal data—prefer “New appointment” over a customer name/service/time unless the user explicitly opts into detail;
- deep-link notification clicks to an in-scope URL, focus an existing client when possible, and require current authorization; and
- do not use push as an invisible data synchronization channel on Safari.

Service workers are event-driven and short-lived. Do not rely on timers, persistent in-memory state, periodic refresh, or guaranteed background execution. Appointment truth must remain server-owned and refresh on foreground/resume.

## Accessibility and resilience gates

The current code already has `:focus-visible`, dialog focus restoration, inert underlays, and `prefers-reduced-motion` handling. Preserve those behaviors in installed mode and add these gates:

- zoom to at least 200%, with spot checks at 400%; no clipped fixed controls;
- OS text scaling and smallest supported width without horizontal loss of essential content;
- keyboard navigation and screen-reader announcements for offline, update, install, and reconnect states;
- minimum touch targets and safe-area spacing around bottom actions;
- no orientation lock;
- high contrast/forced colors and light/dark theme-color contrast;
- reduced motion for install/update affordances and sheet transitions; and
- online/offline status used only as a hint—`navigator.onLine` cannot prove the server is reachable.

## Phased implementation plan

### Phase 1 — responsive/installable foundation

1. Replace the conditional viewport with `width=device-width, initial-scale=1, viewport-fit=cover`.
2. Add left/right safe-area composition and keyboard/rotation tests.
3. Add a stable root-scoped manifest, SSR manifest/theme metadata, 192/512/512-maskable/180 Apple icons, and tests for exact head/manifest contracts.
4. Prefer responsive layout over the frozen user-agent presentation decision; at minimum make the decision react to actual window geometry.
5. Validate HTTPS production headers and manifest/icon URLs.

### Phase 2 — conservative lifecycle

1. Register a root-scoped service worker only in production-like secure contexts.
2. Start with install/activate handling only and no `fetch` listener; keep all requests network-authoritative.
3. Add waiting-worker update UI and cross-version tests.
4. Treat fingerprinted-static-asset caching and a non-sensitive offline fallback as a later opt-in change, with tests proving all documents, auth, server functions, APIs, and mutations remain excluded.

### Phase 3 — install UX and platform polish

1. Add a post-value install promotion, Chromium prompt integration, iOS instructions, dismissal cooldown, and installed-mode detection.
2. Add scrubbed narrow/wide screenshots and useful manifest shortcuts.
3. Add telemetry for eligibility, prompt shown, accepted/dismissed, installed launch, offline fallback, and update failure without logging URLs containing tokens or customer data.

### Phase 4 — optional engagement

Design Web Push as a separate Notification capability with explicit opt-in, subscription lifecycle, privacy-safe payloads, and server authorization. Do not block the PWA launch on it.

## Verification matrix

Use DevTools for diagnosis, but real installed apps for acceptance. Chrome's Application panel validates manifest load/installability, maskable safe zones, shortcuts, screenshots, service workers, caches, offline simulation, and update state. [Chrome DevTools PWA guide](https://developer.chrome.com/docs/devtools/progressive-web-apps), [Edge DevTools PWA guide](https://learn.microsoft.com/en-us/microsoft-edge/devtools/progressive-web-apps/)

Minimum matrix:

| Platform           | Browser/install path                  | Required checks                                                                                              |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| current iPhone iOS | Safari/Share → Add to Home Screen     | standalone launch, notch/home indicator, keyboard, push capability detection, external Operations navigation |
| current iPadOS     | Safari, portrait/landscape/split view | responsive presentation, resize, pointer + touch, keyboard, installed window                                 |
| Android phone      | Chrome install promotion/menu         | manifest eligibility, maskable icon, viewport, Back, honest offline behavior, update                         |
| Windows            | Edge and Chrome installed window      | resize from narrow to wide, shortcuts, taskbar icon, multi-window/update                                     |
| macOS              | Safari and Chrome installed apps      | installed-mode detection, auth callbacks, external links, update/cache behavior                              |

Journey cases:

1. fresh visit → sign in → onboarding → install → launch;
2. installed launch with valid, expired, and revoked sessions;
3. cold offline launch and warm offline navigation—expect a clear network failure in the initial network-only release, or the non-sensitive fallback if that later phase is implemented;
4. online loss during a mutation—no false success and no silent replay;
5. update waiting while a form is dirty, then accepted reload;
6. logout → Back → sign in as a different owner;
7. rotate or resize with a sheet open and during a drag;
8. software keyboard with each auth/onboarding field and validation error;
9. safe-area checks on every fixed top/bottom/left/right action;
10. in-scope deep links, notification shortcut links, 404, and server error;
11. cross-origin Operations return and future auth/payment provider round trips; and
12. icon appearance under Android masks, iOS Home Screen, Windows taskbar, and macOS dock.

Do not treat Lighthouse alone as acceptance. Desktop device emulation does not reproduce actual mobile install UI, standalone window behavior, keyboard/safe-area geometry, process eviction, or iOS background restrictions.

## Definition of done

- One stable manifest is linked from every Merchant document and served successfully over HTTPS.
- The installed app identity does not change when the launch route changes.
- The viewport is device-width, zoom remains enabled, and `viewport-fit=cover` is paired with four-sided safe-area layout.
- Mobile/desktop behavior follows available space instead of remaining frozen from the initial user agent.
- Browser, standalone phone, split-view tablet, and resizable desktop windows remain usable.
- No authenticated SSR page, auth response, server-function response, API response, mutation, callback URL, or payment state is stored in Cache Storage.
- The initial network-only release fails honestly when offline; if an offline fallback is later added, it contains no sensitive Merchant data. Failed writes are never reported as successful or silently queued.
- Before any future worker controls cached assets, a waiting update cannot destroy unsaved work and updates converge after user acceptance.
- Install UI is contextual, dismissible, accessible, and hidden when unsupported/already installed.
- External origins remain visibly external and returns revalidate authoritative state.
- Push, if later added, is user-initiated, privacy-safe, account-scoped, and never required for core correctness.

## Confidence and open decisions

Confidence is high on the viewport correction, manifest shape, scope, caching boundary, install-event limitations, iOS push requirements, and test gaps because each follows the current source tree and primary platform documentation.

Product/design still needs to decide:

- final app name and icon artwork;
- whether the initial manifest colors should be neutral light, neutral dark, or brand-specific;
- the oldest supported iOS/iPadOS and Android versions;
- whether narrow iPads should use the phone interaction model; and
- whether the first release promises only an offline explanation or any read-only cached Merchant data. The latter requires a separate security/domain decision and must not be inferred from “PWA.”
