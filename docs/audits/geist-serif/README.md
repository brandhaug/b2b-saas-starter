# Geist Serif visual verification

## Reproduce

```sh
pnpm -C packages/i18n generate
pnpm run db:migrate:local
pnpm run db:seed
pnpm -C apps/web run build:e2e
pnpm -C apps/web run serve:e2e --port 3181 --strictPort
```

Open `http://localhost:3181/` at 1440 × 1000 and 390 × 844 CSS pixels.
Wait for `document.fonts.ready` before capturing the first viewport.
The before images use base commit `86087eed80fe3faa0f549a385a61908365a8dd0a`.
The after images use the accompanying implementation. Ambient light rays
animate, so their positions differ between captures.

## Observed results

- Before: display headings resolve to Newsreader Variable, weight 500.
- After: all seven display headings resolve to Geist Serif, weight 400,
  with `font-synthesis: none`. The browser reports the font face loaded.
- The landing page requests one Geist Serif WOFF2 alongside Geist Sans and Mono.
- Neither desktop nor mobile has horizontal document overflow. The desktop
  headline retains two lines and the mobile demo action stays in the first viewport.
- A fresh navigation to `/sign-in` uses Geist Sans and requests no Geist Serif asset.
- Norwegian `/no` renders Geist Serif at both viewport sizes without horizontal
  overflow or clipped display headings. The mobile demo action ends at 437px,
  within the 844px viewport.
- The typography detector reports no findings.

| Viewport | Before                                    | After                                     |
| -------- | ----------------------------------------- | ----------------------------------------- |
| Desktop  | ![Newsreader desktop](before-desktop.png) | ![Geist Serif desktop](after-desktop.png) |
| Mobile   | ![Newsreader mobile](before-mobile.png)   | ![Geist Serif mobile](after-mobile.png)   |
