# Merchant PWA booking navigation on iOS

Date: 2026-07-16

## Question

How can a customer move from the installed `/:merchantSlug/` Home Screen web app into booking without iOS presenting the booking URL in a Safari-style browser surface?

## Verdict

Use the merchant-first booking URL `/:merchantSlug/booking` (and keep every subsequent booking document under `/:merchantSlug/booking/**`) on the same origin as the installed merchant page.

The current implementation creates a direct manifest-scope mismatch:

| Concern                       | Current value            | Result                                                         |
| ----------------------------- | ------------------------ | -------------------------------------------------------------- |
| Manifest `start_url`          | `/:merchantSlug/`        | Correct merchant launch URL                                    |
| Manifest `scope`              | `/:merchantSlug/`        | Only same-origin paths beginning with this prefix are in scope |
| Booking CTA                   | `/booking/:merchantSlug` | Outside that merchant's scope                                  |
| Already-supported alternative | `/:merchantSlug/booking` | Inside that merchant's scope                                   |

This is a high-confidence explanation for the browser controls in the supplied screenshot. Apple states the iOS behavior directly: links outside a Home Screen web app's scope open in Safari View Controller. The Web App Manifest specification likewise recommends prominent URL/origin UI when the active document is out of scope and permits the user agent to change the applied display mode for security. It defines scope as an origin check followed by a simple path-prefix check. [Apple WWDC23: What's new in web apps](https://developer.apple.com/videos/play/wwdc2023/10120/), [`scope` and navigation-scope rules](https://www.w3.org/TR/appmanifest/#navigation-scope), [`display` and security-driven display-mode changes](https://www.w3.org/TR/appmanifest/#display-modes)

The best product fix is therefore to change the public page's canonical `bookingPath` to `/${merchantSlug}/booking`, not to try to hide the browser controls.

## Repository findings

### The manifest is already configured for standalone merchant apps

`apps/web/src/lib/merchant-pwa.ts` generates:

```json
{
  "id": "/mara-booking-studio",
  "start_url": "/mara-booking-studio/",
  "scope": "/mara-booking-studio/",
  "display": "standalone"
}
```

`apps/web/src/routes/$merchantSlug.tsx` also emits Apple's `apple-mobile-web-app-capable=yes` metadata. Apple documents that standalone Home Screen web apps omit the Safari URL field and bottom button bar, and WebKit states that a manifest with `display: "standalone"` or `"fullscreen"` launches as a separate Home Screen web app. [Apple standalone-mode documentation](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html#//apple_ref/doc/uid/TP40002051-CH3-SW4), [WebKit's iOS/iPadOS Home Screen web-app behavior](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)

In other words, standalone mode is not missing. The screenshot shows the symptom after navigation leaves the scope in which that standalone presentation applies.

### The CTA leaves the declared scope

Both the seed and live scheduling adapters construct `bookingPath` as `/booking/${merchantSlug}` in `packages/capabilities/src/scheduling/scheduling.ts`. The special merchant presentation eventually calls `window.location.assign(bookingPath)`; the default presentation follows a normal same-context anchor to the same value.

For merchant `mara-booking-studio`:

```text
scope:   /mara-booking-studio/
target:  /booking/mara-booking-studio
         ^ does not start with the scope path
```

The manifest specification first rejects different origins, then compares the target path to the scope path by prefix. It also advises an obvious URL/origin indicator for an out-of-scope active document. Apple describes the concrete iOS implementation as Safari View Controller, which matches the close button, visible origin, share control, and navigation controls in the supplied image. [Apple WWDC23: What's new in web apps](https://developer.apple.com/videos/play/wwdc2023/10120/), [normative scope algorithm and out-of-scope UI guidance](https://www.w3.org/TR/appmanifest/#navigation-scope)

### An in-scope route already exists

The public ingress in `apps/web/src/lib/booking-dispatch.ts` recognizes both URL shapes:

- `/booking/:merchantSlug`
- `/:merchantSlug/booking` and its descendants

The booking worker has `apps/booking/src/routes/$merchantSlug.booking.tsx` and descendant routes under the merchant-first prefix. The production topology also keeps booking behind the `www.<domain>` public ingress through a Cloudflare service binding, so it does not need a cross-origin browser navigation.

That means the PWA-safe canonical path is already routable; the public booking-page contract is simply generating the other supported shape.

## What each PWA setting can and cannot do

### `scope`

`scope` controls which active document URLs remain part of the installed web app. A target must be on the same origin and its path must begin with the scope path. A trailing slash avoids accidental prefix matches. [Web App Manifest navigation scope](https://www.w3.org/TR/appmanifest/#navigation-scope)

Current `/:merchantSlug/` scoping is a good merchant-isolation boundary if all merchant journeys use merchant-first URLs.

### `start_url`

`start_url` is the preferred URL loaded when the user launches the app from its icon. It is advisory and does not widen the URLs considered in scope. [Web App Manifest `start_url`](https://www.w3.org/TR/appmanifest/#start_url-member)

Changing only `start_url` cannot repair this navigation.

### `id`

`id` identifies the installed web app. It does not point to a required navigable resource, does not need to be within scope, and does not add URLs to scope. WebKit says iOS/iPadOS use the manifest ID with the user-selected name to identify web apps for features such as Focus synchronization. [Web App Manifest `id`](https://www.w3.org/TR/appmanifest/#id-member), [WebKit manifest-ID behavior](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/#manifest-id)

The existing per-merchant `id` is sensible, but it cannot make `/booking/:merchantSlug` in scope.

### Manifest scope versus service-worker scope

These are different mechanisms. Manifest scope governs the installed app's navigation/presentation boundary. Service-worker registration scope selects which clients and fetches a worker can control. The current service worker has no fetch handler anyway. Widening only `navigator.serviceWorker.register(..., { scope })` will not remove iOS browser chrome. [Service Worker registration and scope model](https://www.w3.org/TR/service-workers/#service-worker-registration-concept)

### `display: "standalone"` versus `"fullscreen"`

`standalone` already excludes the standard URL bar when the manifest is applied. `fullscreen` is not an escape hatch for off-scope navigation: the specification explicitly allows a user agent to change the applied display mode for security when navigation goes out of scope. [Display modes](https://www.w3.org/TR/appmanifest/#display-modes)

On iOS 26 and iPadOS 26, users can also turn off **Open as Web App** when adding a site to the Home Screen. A site cannot override that user choice. [WebKit: Every site can be a web app on iOS and iPadOS 26](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/#every-site-can-be-a-web-app-on-ios-and-ipados)

## Navigation behavior to preserve

### Same-context navigation

Keep the booking action as a normal anchor without `target`, router navigation in the same top-level context, or `window.location.assign()`.

The current animated transition uses `window.location.assign()`, which is compatible with this goal. It is the target URL, not that API, that is wrong.

### Avoid `_blank` for the primary booking journey; reserve `window.open()` for its documented exception

`target="_blank"` creates a new top-level navigable rather than using the current context. It is therefore the wrong semantic for a continuous merchant-to-booking journey. [HTML navigable target rules](https://html.spec.whatwg.org/multipage/document-sequences.html#valid-navigable-target-name-or-keyword)

Apple documents a specific iOS web-app exception for authentication: links loaded through `window.open()` stay in the web app regardless of scope, intended to keep OAuth flows in context. That is useful for a genuinely cross-origin authentication popup, but it should not be used to bypass a fixable first-party route mismatch. It creates an auxiliary browsing context, relies on special platform behavior, and leaves the incorrect scope model in place. [Apple WWDC23: What's new in web apps](https://developer.apple.com/videos/play/wwdc2023/10120/)

There is no `_blank` or `window.open()` in the current merchant CTA, so neither caused the screenshot.

### Do not use a redirect to repair an initially out-of-scope click

The clicked URL itself should be in scope. On iOS, activating `/booking/:merchantSlug` is already an out-of-scope link, so the navigation opens Safari View Controller before a server redirect can canonicalize it. Redirecting that browser context back to `/:merchantSlug/booking` should not be relied upon to reattach the page to the already-running Home Screen app.

The reverse also matters: an in-scope URL that eventually redirects to another origin or to `/booking/:merchantSlug` commits an out-of-scope active document and can acquire the prominent security UI allowed by the manifest specification. [Apple WWDC23: What's new in web apps](https://developer.apple.com/videos/play/wwdc2023/10120/), [out-of-scope active-document behavior](https://www.w3.org/TR/appmanifest/#navigation-scope)

Keep canonicalization, session creation, payment-return landing pages, and error/recovery routes under the same `/:merchantSlug/booking/**` prefix whenever they are first-party pages.

### Cross-origin booking cannot be made visually first-party by metadata

A different scheme, host, or port is a different origin and therefore always outside a manifest's navigation scope. If a future deployment sends users to `booking.<domain>`, an external provider, or another local-development port, browser/security UI is expected and cannot be hidden by HTML, CSS, `start_url`, `id`, or a service worker.

For a seamless PWA journey, continue the existing production design: proxy/dispatch booking behind the same public origin and expose it at an in-scope merchant-first URL. Allow genuinely third-party steps to show trusted browser UI rather than imitating or suppressing it.

## Universal links and App-Bound Domains are not PWA fixes

Apple Universal Links associate website URLs with a compiled native app by combining an Associated Domains entitlement with an `apple-app-site-association` file. They open the native app when installed and otherwise open a browser. They are not a way to extend an installed web app's manifest scope. [Apple Universal Links setup](https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app), [Apple Universal Links behavior and diagnostics](https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links/)

Apple's similarly named **App-Bound Domains** are an opt-in privacy mechanism for a native application's `WKWebView`. They limit powerful native web-view APIs and optionally block navigation outside a native app's allowlist. They do not configure Safari/Home Screen PWA presentation. [WebKit App-Bound Domains](https://webkit.org/blog/10882/app-bound-domains/)

Use these only if the product later ships a native wrapper; neither addresses the current web-only route mismatch.

## Recommended change sequence

1. Make the scheduling/publication contract generate `/${merchantSlug}/booking` for both seed and live adapters.
2. Update contract, integration, and UI tests that currently assert `/booking/${merchantSlug}`.
3. Keep every booking-session navigation under `/${merchantSlug}/booking/**`; audit redirects and return URLs for the booking-first alias.
4. Keep the manifest values as `id: "/${merchantSlug}"`, `start_url: "/${merchantSlug}/"`, `scope: "/${merchantSlug}/"`, and `display: "standalone"`.
5. Keep booking navigation in the current top-level context; do not introduce `_blank` or use the `window.open()` authentication exception as a routing workaround.
6. Retain `/booking/:merchantSlug` only as a non-PWA compatibility ingress if needed. It may redirect to the merchant-first canonical path for ordinary browser traffic, but the PWA CTA itself must link directly to the in-scope path.

### Why not widen every merchant manifest to `/`?

Changing manifest scope to `/` would put `/booking/:merchantSlug` in scope, but it also makes the public homepage, docs, and every other merchant's pages part of every installed merchant app. That weakens the per-merchant identity expressed by the current `id`, `start_url`, and service-worker registration. It is technically broad enough, but it is a poorer product boundary than using the already-supported merchant-first booking routes.

If booking-first URLs must remain canonical for a hard external constraint, root scope is the fallback. It should be treated as an explicit architecture decision and tested for interactions between multiple merchant installs on one device.

## Device verification plan

Test on at least the oldest supported iOS/iPadOS release and current iOS 26 because Home Screen installation UI changed in iOS 26.

1. Delete the existing Home Screen install so cached install metadata cannot mask the result.
2. Open the HTTPS public merchant URL on the device and add it to the Home Screen with **Open as Web App** enabled where that toggle exists.
3. Launch from the Home Screen and confirm both:
   - `window.matchMedia('(display-mode: standalone)').matches` is true; and
   - on iOS, `navigator.standalone === true` as an additional platform signal. Apple documents `navigator.standalone` for detecting its standalone mode. [Apple standalone detection](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html#//apple_ref/doc/uid/TP40002051-CH3-SW4)
4. Tap **Book an appointment** and record the final `location.href`. It should be same-origin and begin with `/${merchantSlug}/booking`.
5. Walk every booking route, including session creation, selection, checkout, confirmation, back navigation, recovery/error screens, and any payment or authentication return.
6. Confirm no browser URL/share/navigation surface appears on first navigation or after a redirect.
7. Negative controls:
   - navigate to `/booking/${merchantSlug}` and verify iOS is allowed to show off-scope UI;
   - navigate to a different origin and verify external-browser UI is shown;
   - open the in-scope booking URL with `_blank` and verify it is not used as the product navigation pattern.

For local-device tests, use one stable origin. A change from host name to IP address, HTTP to HTTPS, or one port to another is an origin change and invalidates the comparison.

## Acceptance criteria

- The installed merchant page launches without standard browser chrome.
- Booking stays on the same scheme/host/port as the merchant page.
- The final URL and all first-party booking URLs begin with `/${merchantSlug}/booking`.
- The booking CTA does not use `_blank` or `window.open()`.
- No first-party redirect ends at `/booking/${merchantSlug}` or another out-of-scope URL.
- Multiple different merchant PWAs can be installed and each retains its merchant-scoped identity.
- External-provider navigation remains visibly external; the app does not attempt to spoof or suppress user-agent security UI.

## Confidence and limitation

The standards rule, repository URL mismatch, and screenshot symptom line up directly, so confidence in the diagnosis is high. Exact iOS chrome styling is implementation- and release-dependent, and the manifest specification deliberately gives user agents discretion over presentation. Final confirmation must therefore be an on-device test of the production-like HTTPS origin rather than a desktop emulator assertion.
