# Poke home background images: deep research

Observed and source-verified on **2026-07-22** against Poke's current first-party production shell and versioned production bundles.

## Executive summary

Poke's authenticated home uses **two coordinated image families**, not one background:

1. A large, low-detail **sky photograph** surrounds the centered app card on desktop only.
2. A more illustrative **beach scene** appears inside the home card on both desktop and mobile.

Both families have morning, afternoon, evening, and night variants. They are selected from the **browser's local hour**, not from the weather response, system color scheme, or a mobile User-Agent. A 100×100 RGB-noise PNG is repeated over the card and separately over the hero.

At the current production breakpoint, desktop means `min-width: 768px`. Below 768px, the outer sky `<img>` is not rendered and the desktop gradient is replaced with transparent; the themed card and beach hero remain.

The outer sky fades over two seconds when its URL changes. The gradient, card color, hero URL, and hero scale have no corresponding transition in the home component.

## Primary sources

- Production app shell: [https://poke.com/home](https://poke.com/home)
- Versioned JavaScript bundle inspected: [https://poke.com/vc-ap-d2a57d/main-BVF0Yfk1.js](https://poke.com/vc-ap-d2a57d/main-BVF0Yfk1.js)
- Versioned CSS bundle inspected: [https://poke.com/vc-ap-d2a57d/main-2g7dZe_e.css](https://poke.com/vc-ap-d2a57d/main-2g7dZe_e.css)
- The asset URLs in the tables below are first-party `poke.com` files referenced directly by that JavaScript bundle.

The versioned bundle URLs matter: this report describes the production build served on the observation date. A later deployment may change the hash and implementation.

## Complete home-background asset inventory

### Desktop outer-sky images

These images are 3:2 JPEGs. Poke uses them only when the viewport media query reports at least 768 CSS pixels.

| Theme     | First-party asset                                                                                                      | Natural size | Download size | SHA-256                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------- | -----------: | ------------: | ------------------------------------------------------------------ |
| Morning   | [`/app-assets/weather/morning-sky-background.jpg`](https://poke.com/app-assets/weather/morning-sky-background.jpg)     |    3072×2048 |   1,078,644 B | `6f0b261225384c45a98704561ce5c6605e2b8f8e2cd3fa9550ea428e623d40c3` |
| Afternoon | [`/app-assets/weather/afternoon-sky-background.jpg`](https://poke.com/app-assets/weather/afternoon-sky-background.jpg) |    3072×2048 |   1,022,867 B | `b95bda7bb3dacb20b343b4e97d67ff7f225b93d7c4776458dd6b7a001304c226` |
| Evening   | [`/app-assets/weather/evening-sky-background.jpg`](https://poke.com/app-assets/weather/evening-sky-background.jpg)     |    3072×2048 |   1,139,004 B | `2e24b9de7136f8af5c69631caea339301cc79dc347e10cc0e18fe27c3648661d` |
| Night     | [`/app-assets/weather/night-sky-background.jpg`](https://poke.com/app-assets/weather/night-sky-background.jpg)         |    3072×2048 |   1,185,139 B | `962145eb2a09d95946d08bfbf1d77a4d098d1a0b32ada8ef87e0bda4012c5bb3` |

The art direction is deliberately quiet in the center, where the card sits: pale violet clouds for morning, blue sky and a top-right sun for afternoon, diffuse peach cloud for evening, and a sparse deep-blue star field for night. The low-detail center is in the source images; Poke does **not** blur or desaturate these files in CSS.

### In-card beach hero images

These images are 3:2 JPEGs of the same beach composition at four times of day. The home card renders the selected hero on desktop and mobile.

| Theme     | First-party asset                                                                                                                                  | Natural size | Download size | Runtime scale | SHA-256                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -----------: | ------------: | ------------: | ------------------------------------------------------------------ |
| Morning   | [`/app-assets/interaction_beach/interaction_beach_morning.jpeg`](https://poke.com/app-assets/interaction_beach/interaction_beach_morning.jpeg)     |    1536×1024 |     523,313 B |          1.40 | `5cd15913e0da6c24d92f777e331666c151a9283258497734a9a05b17d9f8c631` |
| Afternoon | [`/app-assets/interaction_beach/interaction_beach_afternoon.jpeg`](https://poke.com/app-assets/interaction_beach/interaction_beach_afternoon.jpeg) |    1536×1024 |     893,831 B |          1.45 | `a3839935b9524a82c85e0ad0c045c3c79bc245d97ddbb556fd86f1c0378c4790` |
| Evening   | [`/app-assets/interaction_beach/interaction_beach_evening.jpeg`](https://poke.com/app-assets/interaction_beach/interaction_beach_evening.jpeg)     |    1536×1024 |     531,358 B |          1.40 | `a941600ab6545c2a0500cc2726d372863504d57389a0110e1a20c386a1d25449` |
| Night     | [`/app-assets/interaction_beach/interaction_beach_night.jpeg`](https://poke.com/app-assets/interaction_beach/interaction_beach_night.jpeg)         |    1536×1024 |     317,899 B |          1.30 | `6e5437d3cc5b834b22859e8b584e73dd49456b5f66821d3e4907a975371cdd6a` |

### Home grain texture

| Asset                                                            | Natural size | Download size | Home usage                                               | SHA-256                                                            |
| ---------------------------------------------------------------- | -----------: | ------------: | -------------------------------------------------------- | ------------------------------------------------------------------ |
| [`/app-assets/noise.png`](https://poke.com/app-assets/noise.png) |  100×100 PNG |      24,937 B | Repeated over the full card and separately over the hero | `df154c2b46a461001e28873b99c6fcf9c9220873fb89bf433d3c46c746fdc317` |

The bundle also references [`/app-assets/noise.webp`](https://poke.com/app-assets/noise.webp), a 300×300 WebP, but that file belongs to Poke's login/get-started/device shells (`NoiseOverlay` at 4% opacity with `mix-blend-mode: difference`). It is **not** the authenticated home texture. Likewise, `custom_automations_background.webp` and other files preloaded by the static app shell are not part of the home background pipeline.

## Theme-selection algorithm

The production bundle defines one `TIME_THEME_CONFIG` object and selects its key from `new Date().getHours()`:

```js
hour >= 5 && hour < 11
  ? 'morning'
  : hour >= 11 && hour < 17
    ? 'afternoon'
    : hour >= 17 && hour < 20
      ? 'evening'
      : 'night'
```

The corresponding ranges are:

| Browser-local hour | Theme assets |
| ------------------ | ------------ |
| 05:00–10:59        | Morning      |
| 11:00–16:59        | Afternoon    |
| 17:00–19:59        | Evening      |
| 20:00–04:59        | Night        |

`TimeThemeProvider` initializes from the browser clock, then runs a `setInterval(..., 60000)` and refreshes the hour once per minute. A boundary therefore takes effect on the first minute poll after it is crossed. It uses browser-local `Date#getHours`; the inspected code does not use the account timezone, weather location, sunrise/sunset, or server time.

The provider includes an internal `debugThemeOverride` state. Its four representative debug hours are morning `8`, afternoon `14`, evening `19`, and night `23`. The production `DebugThemeToggle` listens for `⌘⌥D`, but the inspected component only toggles its own visibility state and renders `null`; no exposed theme chooser was found in this build.

### Weather does not choose the image

The name `weatherImage` and alt text `Weather background` can be misleading. `useWeather()` requests `/api/v1/weather`, but `AuthenticatedHomeView` consumes that result only to display rounded temperature, units, and `weather[0].description`. Background selection comes entirely from `TIME_THEME_CONFIG[getHours()]`.

Therefore:

- Clear, cloudy, rainy, or snowy weather does not select another background in this build.
- Poke has four **time-of-day** sky assets, not a weather-condition asset matrix.
- If the weather request is still loading or unavailable, Poke displays the configured `dayMessage`; the image selection is unchanged.

## Exact desktop compositing

The outer layout emitted by `ICCardsViewLayout` is structurally:

```jsx
<div
  className="relative flex h-full w-full items-center justify-center px-0 max-md:bg-transparent"
  style={{ background: desktopGradient }}
>
  <motion.img
    src={weatherImage}
    alt="Weather background"
    className="pointer-events-none absolute left-0 top-0 z-0 h-full w-full object-fill"
    style={{ opacity: 0.9, minWidth: '2000px', minHeight: '1200px' }}
  />
  <div className="relative h-full w-full max-w-md text-center md:h-[750px]">
    {/* home card */}
  </div>
</div>
```

Important consequences:

- The sky is a real absolutely positioned `<img>`, not a CSS `background-image`.
- It is anchored at the **top-left**, not centered.
- `width: 100%; height: 100%` is combined with `min-width: 2000px; min-height: 1200px`.
- `object-fit: fill` stretches the raster to the resulting box. It is not `cover` or `contain`.
- The image has `opacity: 0.9`; no `filter`, blur, saturation, or blend mode is assigned.
- The layout behind it carries a theme-specific CSS gradient.
- The image is non-interactive (`pointer-events: none`) and at `z-index: 0`.
- The centered content wrapper is at most `28rem` (448px) wide and is 750px tall at the desktop breakpoint.
- The home card has a 24px desktop radius and Poke's `shadow-alyn`: `0 0 1px #0003`, `0 2px 4px #0000000a`, `0 16px 22px #00000008`.
- The global app CSS normally clips viewport overflow (`html, body { height: 100%; overflow: hidden; }`), so the 2000×1200 minimum image is cropped by the viewport rather than creating page scroll.

Live computed-layout probes agree with the source:

- At a 1280×720 viewport, the outer image box is 2000×1200 at `(0, 0)`, so the right and bottom are clipped.
- At 2560×1440, the image box is exactly 2560×1440.
- Its rendered dimensions are therefore `max(viewportWidth, 2000)` × `max(viewportHeight, 1200)`, top-left anchored.
- Because the source is 3:2 and the element uses `object-fill`, the complete source is first distorted to that element-box aspect ratio; viewport clipping happens afterward.

### Desktop gradients and card bases

| Theme     | Desktop outer gradient                                                                                        | Card base color      |
| --------- | ------------------------------------------------------------------------------------------------------------- | -------------------- |
| Morning   | `linear-gradient(180deg, #ced6eb 0%, #e9e2e8 50%, #ced6eb 100%)`                                              | `rgb(248, 250, 252)` |
| Afternoon | `linear-gradient(0deg, rgba(56, 189, 248, .6) 0%, rgba(186, 230, 253, .6) 50%, rgba(224, 242, 254, .7) 100%)` | `rgb(224, 242, 254)` |
| Evening   | `linear-gradient(0deg, #F7B385 0%, #F0BEA9 50%, #FFF3EF 100%)`                                                | `rgb(255, 247, 237)` |
| Night     | `linear-gradient(180deg, #010203 0%, #020508 25%, #030a12 50%, #040d1a 75%, #071a2a 100%)`                    | `rgb(17, 23, 32)`    |

The sky's 90% opacity means only 10% of the gradient contributes through fully opaque pixels. The gradient is still valuable during the image's fade-in/fade-out and at any uncovered edge.

## Authenticated app-container background: complete layer audit

The visible Poke home “container” is not one background declaration. It is a stack of ordinary DOM elements whose paint order is important. In back-to-front order, the current production implementation is:

1. **Document/body fallback.** At `min-width: 768px`, `body` is Tailwind gray 100 (`oklch(96.7% 0.003 264.542)`, conventionally rendered approximately as `#f3f4f6`). Below 768px, `body` is black. Both rules first declare `background-color: var(--color-background)` and then override it with gray 100 or black in the same rule. These are fallback surfaces; the full-size home layout/card normally covers them.
2. **Ionic page host.** `Router` mounts the persistent home as the first child of `<IonPage class="h-full">`. It does not assign a home-specific image, gradient, filter, or color at this level.
3. **Full-viewport home layout (`ICCardsViewLayout`).** This is `position: relative`, `display: flex`, full width/height, and centers its children. On desktop its inline `background` is the current theme's `desktopGradient`; below 768px that inline background is `transparent` and the class also supplies `max-md:bg-transparent`.
4. **Desktop weather sky.** A real absolutely positioned `<motion.img>` is painted above that gradient at `z-index: 0`, 90% opacity. It exists only at 768px and above.
5. **Centered transparent wrapper.** `[data-silk-sheet-wrapper]` is relative, full-height/full-width, capped at 448px; at desktop it is 750px tall. It has no background of its own.
6. **Opaque app card (`ICContentCard`).** The card paints the current theme's exact `rgb(...)` color. It is full-height, a flex column, with 16px top and bottom padding, Poke's three-part shadow, and a 24px radius only at the desktop breakpoint.
7. **Card-wide grain `<div>`.** An absolutely positioned repeated `noise.png` layer sits at `z-index: 0` inside the card. It uses the same desktop radius and fades in over the first 30px through a mask.
8. **Foreground content wrapper.** A relative, full-size flex column at `z-index: 10` holds the header, beach hero, greeting and actions.
9. **Inside the hero only:** the beach `<img>`, the radial card-color fade above it, and a second unmasked `noise.png` layer above both.

This can be reduced to the following paint model:

```text
body fallback
└─ IonPage
   └─ full-screen desktop gradient / transparent mobile
      ├─ desktop-only sky image (z: 0, opacity: .9)
      └─ centered transparent wrapper (max 448px)
         └─ opaque time-colored card + shadow
            ├─ masked repeated grain (z: 0)
            └─ foreground content (z: 10)
               └─ hero: beach image → radial fade → repeated grain
```

### Exact card shell values

The compiled home card is equivalent to:

```jsx
<div
  className="relative flex h-full flex-col bg-sky-100 py-4 shadow-alyn md:rounded-3xl"
  style={{ backgroundColor: `rgb(${colors.backgroundRgbString})` }}
>
  <GrainyBackground
    className="z-0 md:rounded-3xl"
    maskImage="linear-gradient(to bottom, transparent 0%, black 30px)"
  />
  <div className="relative z-10 flex h-full w-full flex-col">…</div>
</div>
```

- The inline `background-color` wins over the `bg-sky-100` fallback.
- `py-4` resolves to 16px top and bottom padding because the spacing unit is 4px.
- `md:rounded-3xl` resolves to 24px.
- `shadow-alyn` is exactly `0 0 1px #0003, 0 2px 4px #0000000a, 0 16px 22px #00000008`.
- There is **no border** on the home card. The thin edge visible against the sky comes from the first `0 0 1px` shadow, not a border stroke.
- The card itself does **not** declare `overflow: hidden`; the desktop grain layer repeats the card's radius and the hero has its own nested clipping containers.
- The card has no `background-image`, CSS gradient, background opacity, `filter`, `backdrop-filter`, or `mix-blend-mode`. It is an opaque flat RGB surface beneath the overlays.

### Effects that are present—and absent

| Layer                        | Background/image                                 | Opacity | Mask                                  | Blend/filter                                | Radius/shadow                    |
| ---------------------------- | ------------------------------------------------ | ------: | ------------------------------------- | ------------------------------------------- | -------------------------------- |
| Body fallback                | Desktop gray 100; mobile black                   |       1 | None                                  | None                                        | None                             |
| Full-screen home layout      | Theme gradient on desktop; transparent on mobile |       1 | None                                  | None                                        | None                             |
| Outer sky `<img>`            | Theme JPEG                                       |     0.9 | None                                  | No filter or blend                          | None                             |
| Transparent centered wrapper | None                                             |       — | None                                  | None                                        | None                             |
| App card                     | Theme RGB                                        |       1 | None                                  | No filter, backdrop blur, or blend          | 24px desktop only; `shadow-alyn` |
| Card grain `<div>`           | Repeated `noise.png`, 100px tile                 |     0.6 | Transparent→black over first 30px     | `background-blend-mode: overlay`; no filter | 24px desktop only                |
| Hero image                   | Theme beach JPEG                                 |       1 | Clipped by nested overflow containers | No filter or blend                          | None                             |
| Hero radial overlay          | Theme-RGB radial gradient                        |       1 | None                                  | No filter or blend                          | None                             |
| Hero grain `<div>`           | Repeated `noise.png`, 100px tile                 |     0.6 | None                                  | `background-blend-mode: overlay`; no filter | None                             |

No `::before` or `::after` pseudo-element is used by these authenticated-home background layers. Both texture effects are real absolutely positioned `<div>` elements. No `backdrop-filter` or `backdrop-blur` participates in the home container treatment; instances of those utilities elsewhere in the bundle belong to buttons, banners, modal surfaces, or other routes. Likewise, `noise.webp` with `mix-blend-mode: difference` belongs to other shells and must not be conflated with this card.

One important adjacent exception is the **five action tiles inside the card**. They are not part of the card's background, but their translucency makes them visually read as another surface in the composition. `ICActionButton` sets both `backgroundColor` and `borderColor` to the theme's `actionButtonColor`, uses a 24px radius, 12px padding, `shadow-alyn`, and `backdrop-blur-xs` (4px). On enabled desktop tiles, hover changes the backdrop blur to `backdrop-blur-lg` (16px). The class declares `transition-transform`, not a general background/backdrop transition, so only the press scale is explicitly transitioned by this component.

| Theme     | Action-tile fill and border | Header hover tint |
| --------- | --------------------------- | ----------------- |
| Morning   | `rgba(248, 250, 252, 0.3)`  | `#ede9fe80`       |
| Afternoon | `rgba(224, 242, 254, 0.3)`  | `#f0f9ff80`       |
| Evening   | `rgba(255, 247, 237, 0.3)`  | `#ffedd580`       |
| Night     | `rgba(46, 49, 62, 0.3)`     | `#f0f9ff40`       |

The `hoverColor` tokens apply to the desktop About and Settings hit targets on pointer enter; they are set back to transparent on pointer leave. They do not repaint the card or page background.

### How the app-container shell changes by theme

All four time themes replace a coordinated token set: outer gradient, outer sky URL, card RGB, hero URL/scale, text colors, button tint and hover tint. The shell does not toggle a global `.dark` class for night. Night is simply another time configuration: an `rgb(17, 23, 32)` card, white/70% white typography, a dark five-stop outer gradient, the night sky and beach assets, a darker translucent action-button color, and a custom ring variable (`240 4.9% 75`). Morning, afternoon and evening retain gray text and their own light card colors.

The grain asset, 60% grain-layer opacity, 100px repeat size, card mask, card radius and shadow do **not** change by time theme. Only the coordinated theme tokens change. The card RGB and outer gradient switch immediately when the minute poll updates; they have no CSS transition. Only the desktop sky has the explicit two-second Framer Motion crossfade.

### Desktop versus mobile container shell

At 768px and above, the user sees the full composition: themed outer gradient, 90%-opaque sky, a centered 448×750px card, 24px card/grain radius and the subtle external shadow. Below 768px, Poke removes the outer sky, makes the full-screen layout background transparent, removes the card/grain radius, and lets the card grow to the available height. On a phone narrower than 448px, the opaque themed card therefore becomes the entire visible app background. The mobile body's black fallback is underneath it and ordinarily does not show through.

At widths from 449px through 767px, the square-cornered card remains capped at 448px and centered. The uncovered side gutters expose the transparent layout and therefore the black mobile body fallback. This is a breakpoint/cap consequence, not a separate time-theme image.

Opening another route marks the mounted home layout `inert`; this changes interactivity, not its background styles. Modal/sheet backdrop effects are separate layers owned by the responsive modal components and are not part of the authenticated home container background described here.

There is, however, deliberate browser-chrome coordination in the mobile sheet system. During sheet travel, `SilkStackingSheetView` writes both `document.body.style.backgroundColor` and `<meta name="theme-color">`; at closed progress it restores the current card RGB. A signed-in live probe consequently found both the inline body color and meta theme color equal to the current card base. During an open/dimmed sheet it computes a darker value from the card RGB (or white for a configured full-height sheet), and the sheet lifecycle animates some of those body/meta changes over 200ms. This is not a hidden card-background animation: the card RGB, its grain, and the hero radial overlay themselves still have no declared transition.

For a standard fully open Settings sheet at a 390×844 viewport, the signed-in live page measured the underlying `[data-silk-sheet-wrapper]` at `translate3d(0, 14px, 0) scale(0.933333)`, with `transform-origin: 50% 0`, `border-radius: 42px`, `overflow: hidden`, and both `filter: brightness(0.8)` and `backdrop-filter: brightness(0.8)`. The body and browser theme color were black, while the card underneath remained the afternoon `rgb(224, 242, 254)`. The apparent darkened “background” behind the sheet is therefore the real mounted card being transformed and brightness-filtered over a black body—not a screenshot, cloned page, replacement image, or conventional translucent black backdrop.

The wrapper scale is calculated as `(viewportWidth - 26px) / viewportWidth`, so its fully open horizontal inset is 13px per side at 390px. Sheet travel interpolates the wrapper from scale `1`, zero translation and zero radius to that inset scale, `14px + safe-area-top` translation and a 42px radius; brightness moves from `1` to `0.8`.

## Exact in-card hero treatment

`TimeThemeImage` uses this arrangement on both desktop and mobile:

```jsx
<div className="relative flex h-full overflow-hidden">
  <div className="relative h-full max-h-96 w-full overflow-hidden">
    <img
      className="h-full w-full select-none object-cover"
      style={{ transform: `scale(${themeScale})`, transformOrigin: 'center' }}
    />
    <div className="absolute inset-0 ..." style={{ background: radialFade }} />
    <GrainyBackground className="z-10" />
  </div>
</div>
```

The image:

- uses `object-fit: cover`;
- is center-scaled by the per-theme values in the asset table;
- is clipped twice by `overflow: hidden` containers;
- can grow to at most 384px high (`max-h-96`);
- receives no CSS image filter.

The fade is a centered ellipse that blends the hero into the card base:

```css
radial-gradient(
  ellipse 90% 65% at center,
  rgba(themeRgb, 0) 0%,
  rgba(themeRgb, 0) 5%,
  rgba(themeRgb, 0.9) 55%,
  rgba(themeRgb, 1) 80%
)
```

This is why the hero does not read as a rectangular photograph: most of its perimeter becomes the exact card color before the image container ends.

## Grain/noise compositing

`GrainyBackground` repeats `noise.png` with these defaults:

```js
{
  position: "absolute",
  inset: 0,
  backgroundImage: "url(/app-assets/noise.png)",
  backgroundRepeat: "repeat",
  backgroundSize: "100px",
  backgroundPosition: "0 0",
  backgroundBlendMode: "overlay",
  opacity: 0.6
}
```

It is used in two places:

1. **Whole card:** `z-0`, desktop radius inherited, and a vertical mask of `linear-gradient(to bottom, transparent 0%, black 30px)`. The mask keeps the very top edge clean and brings the grain in over the first 30px.
2. **Inside hero:** `z-10`, no mask. This puts grain directly over the opaque hero image, which otherwise covers the card-level grain beneath it.

The actual PNG contains colored RGB noise rather than monochrome alpha grain. The visual restraint comes from its small tile, overlay blending, and 60% layer opacity.

## Mobile behavior

The production component makes the mobile choice through `useMediaQuery({ minWidth: 768 })`:

```js
background: isDesktop ? colors.desktopGradient : 'transparent'
weatherImage: isDesktop ? colors.weatherImage : undefined
```

Below 768 CSS pixels:

- no outer weather/sky `<img>` is rendered;
- the outer gradient becomes transparent;
- the content wrapper is full-height and remains capped at 448px width (it fills a narrower phone, but does not expand past 448px on a wider pre-breakpoint viewport);
- the card loses `md:rounded-3xl`; it is square-cornered and edge-to-edge only when the viewport is no wider than its 448px cap;
- the card's time-theme base color, beach hero, radial fade, and both noise treatments remain;
- the hero uses the same source file, same scale, same `object-cover`, and same 384px maximum as desktop.

Viewport-based live probes:

- At 390×844, the card is 390×844 with zero radius. The afternoon hero container is 390×384 at `y = 64`; the scaled image box computes to approximately 565.5×556.8 at `x = -87.75`, `y = -22.4` before clipping.
- At 767×900, the outer sky is absent and the square-cornered card is 448×900, centered at `x = 159.5`.
- At 768×900, the breakpoint flips: the outer sky appears and the card becomes 448×750 at `x = 160`, `y = 75`, with 24px radius.

These are **viewport emulation** measurements, not a real-mobile-UA browser execution.

### Real mobile User-Agent evidence and limitation

The `/home` shell was also fetched with an iPhone Safari User-Agent:

```text
Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)
AppleWebKit/605.1.15 (KHTML, like Gecko)
Version/18.5 Mobile/15E148 Safari/604.1
```

The byte-for-byte HTML response was identical to the normal response (same SHA-256: `858a736da3db03a0b57ad5fd09a6bba0b33f748565c6d7207b5ace845170e0c7`). The home component then branches on `matchMedia` width, not UA detection. This is strong source evidence that Poke does not server-select different home images for mobile.

A signed-in browser execution surface with a changeable real mobile UA was not available to this research worker, so this report does **not** claim a fresh interactive mobile-UA DOM measurement. Earlier measurements made with a 390×844 viewport are viewport-only evidence; they agree with the production code, but are not presented as UA emulation.

## Switching and animation behavior

### Outer sky

The desktop sky is keyed by its URL inside `AnimatePresence` and has:

```js
initial: { opacity: 0 }
animate: { opacity: 0.9 }
exit: { opacity: 0 }
transition: { duration: 2, ease: "easeOut" }
```

When the theme changes, the old keyed sky exits and the new keyed sky enters. With the default presence mode, those operations may overlap. This is the only explicit background-image transition in the inspected home implementation.

### Gradient, card and hero

- `desktopGradient` is an inline `background` value with no transition declared.
- The card base is an inline `backgroundColor` with no transition declared.
- The beach hero is a plain `<img>` whose `src` and transform scale update with the context; it is not keyed, wrapped in `AnimatePresence`, or given a CSS transition.
- The static HTML preload list does not contain any of the eight time-theme images or `noise.png`.
- No dedicated `new Image()` preloader for these theme assets was found in the inspected bundle. The `new Image()` logic near this component belongs to avatar caching.
- A live page-asset inventory during the afternoon theme contained only the current afternoon sky/hero pair, not the other six time variants. That is consistent with on-demand loading rather than eager loading of the entire theme set.

Consequently, the outer sky has a deliberate two-second fade, while the inner theme surfaces change immediately at React render time subject to normal browser image fetching/decoding.

### Reduced motion

No `prefers-reduced-motion` branch is attached to the outer sky transition in the inspected component. Framer Motion may have global behavior elsewhere, but no home-specific reduced-motion override was found; this remains an implementation-level unknown without a live reduced-motion trace.

## State and route behavior

- Authentication state affects header/action content, not which time-theme assets are selected.
- Weather loading/success affects the subtitle text opacity/content, not the images.
- The `inert` prop is passed to the outer layout when another surface needs to disable interaction; it does not alter the background.
- The background configuration has no route argument. A sheet opened over the home route should therefore leave the mounted home theme behind it; route-specific pages can, of course, mount different layouts.
- The only observable selector inputs are browser-local hour and the internal debug override.

## What makes the treatment work

The result is not primarily a CSS-effect trick. It depends on four coordinated choices:

1. **Purpose-built outer assets:** very low-detail, broad-tone skies with room for the centered card.
2. **Two levels of imagery:** abstract atmosphere outside, recognizable narrative art inside.
3. **Exact-color disappearance:** the radial hero overlay ends at the same RGB value as the card.
4. **Texture after compositing:** grain is repeated over otherwise flat card areas and separately over the opaque hero.

Copying only `opacity: .9` or adding blur to a conventional photograph will not reproduce this. The source art, card RGB, gradient, radial fade, and crop/scale are designed as one theme token set.

## Unknowns and confidence limits

- **High confidence:** asset URLs, dimensions, file hashes, time ranges, gradients, card colors, hero scales, breakpoint, DOM styles, noise treatment, and explicit transition values. These come from the current first-party assets and versioned production code.
- **High confidence:** weather conditions do not select the home imagery in this build; the data flow in `AuthenticatedHomeView` uses weather only for text.
- **Medium confidence:** exact paint order in every browser/GPU edge case. The DOM/z-index structure is known, but the signed-in page was not freshly traced in multiple browser engines for this report.
- **Not verified:** whether an unreleased/native wrapper overrides the debug theme, clock, or reduced-motion behavior outside the web bundle.
- **Not found:** service-worker or application-level prefetching specifically for the eight theme images. Absence from the inspected shell and bundle searches is evidence for no explicit preloader in this build, not proof that a browser/CDN cache will never already contain them.
