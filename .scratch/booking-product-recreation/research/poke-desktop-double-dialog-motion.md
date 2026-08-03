# Poke desktop double-dialog motion research

Date captured: 2026-07-26  
Scope: Poke's desktop primary dialog, adjacent detail dialog, and routes inside the adjacent dialog.  
Method: first-party production JavaScript shipped by `poke.com`, the signed-in DOM supplied in the task, and the signed-in geometry captured during the preceding Poke inspection. No secondary sources were used.

## Executive finding

Poke's **adjacent dialog enters from the right**. It does not enter from the bottom.

When the adjacent dialog closes, Poke does **not** wait for its exit to finish
before recentering the primary dialog. Both changes are committed together: the
right dialog begins an opacity-only exit while the left dialog immediately starts
its recenter spring. The left spring has a long, low-amplitude settling tail, but
its meaningful travel is front-loaded: it covers about 77% of the distance in
100 ms, reaches about 96% by 133 ms, and first crosses the center around 145 ms.

The distinction matters because Poke has two independent motion layers:

1. The adjacent dialog itself travels horizontally from beyond the right edge of the viewport into its final paired position.
2. A later route change _inside_ an already-open dialog can use Ionic's platform transition. In desktop/Material mode, that inner content transition rises by 40 px and fades in. That is not the adjacent dialog entering.

The merchant implementation now matches both parts of this close choreography:
the adjacent dialog begins at `left: 100%`, keeps a constant
`translateY(-50%)`, and does not scale; on close the primary recenters in the
same commit as the sidecar fade, using a sampled 400/25 spring response that
matches Poke through the highly visible first 150 ms.

## Primary evidence

### 1. Poke's double-dialog component

Poke's production bundle contains `ICResponsiveDoubleModalLayout`, which defines separate Framer Motion variants for the left and right dialogs. The relevant behavior is:

| Element      | Initial state                                  | Paired/open state                                                               | Exit                                                   |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Left dialog  | centered, `scale: 0.95`, `opacity: 0`          | moves from `translateX: -50%` to `translateX: -100%`; `translateY` stays `-50%` | fades and scales to `0.95` when the entire pair closes |
| Right dialog | `left: 100%`, `translateY: -50%`, `opacity: 0` | `left: 50%`, `translateX: 15px`, `translateY: -50%`, `opacity: 1`               | fades in place when the right dialog closes            |
| Backdrop     | `opacity: 0`                                   | `opacity: 1`                                                                    | `opacity: 0`                                           |

The left dialog uses a spring configured with damping 25 and stiffness 400. The right dialog uses a spring configured with damping 30 and stiffness 300. The right variant declares a 0.15 s duration, but its stiffness/damping are the important spring characteristics. The backdrop uses a 0.1 s opacity transition.

When the primary dialog first opens by itself, it is a different animation again:
the panel fades in and springs from scale 0.95 to 1 while remaining centered. A live
capture reached opacity 1 around 190 ms, briefly overshot to scale ≈ 1.003, and
settled near 227 ms. This root-modal scale entrance must not be reused for the
adjacent dialog.

Source: [Poke production application bundle](https://poke.com/vc-ap-d2a57d/main-CtGUTzKH.js), component `ICResponsiveDoubleModalLayout` in the asset captured on 2026-07-26. Captured SHA-256: `21c25c88e7fad2fa4d3ec9da5df1dd1e5cac22b594a50b276d2369e133063d59`.

### 2. Signed-in final geometry

At a 1280 × 720 viewport, the preceding signed-in inspection measured:

| Element      | Bounds after pairing                        | Final transform contribution       |
| ------------ | ------------------------------------------- | ---------------------------------- |
| Left dialog  | x = 128, width = 512, height = 752, y = -16 | x = -512 px (`-100%` of its width) |
| Right dialog | x = 655, width = 512, height = 752, y = -16 | x = +15 px, y = `-50%`             |

Those measurements agree exactly with the production variants and the DOM supplied in the task (`left: 50%`, `translateX(15px)`, `translateY(-50%)`).

For the right dialog at this viewport:

- initial left edge: 1280 px (`left: 100%` and no x translation);
- final left edge: 655 px (`50%` of 1280 + 15 px);
- horizontal travel: 625 px;
- vertical travel: 0 px, because `translateY: -50%` is identical at both ends.

This is an unambiguous right-to-left entrance.

### 3. Poke mounts both panels concurrently

The same component wraps the backdrop, left dialog, and right dialog in one `AnimatePresence`. When the right dialog becomes open:

- the existing left dialog animates to its paired-left variant;
- the newly mounted right dialog simultaneously animates from the offscreen-right variant;
- focus transfers to the right dialog on the next animation frame.

The two movements form one coordinated composition. The right dialog is not treated as a sheet and does not inherit a bottom-sheet transform.

Source: [Poke production application bundle](https://poke.com/vc-ap-d2a57d/main-CtGUTzKH.js), `ICResponsiveDoubleModalLayout`.

### 4. Live entry and exit frame capture

A fresh signed-in capture at 1280 × 720 sampled the fixed panels while clicking
**Messaging** from Settings. The right dialog's vertical coordinate remained exactly
`y = -16` throughout. Its horizontal position and opacity changed as follows:

| Elapsed | Right dialog x | Right dialog y | Opacity |
| ------: | -------------: | -------------: | ------: |
|   28 ms |        1275.71 |            -16 |   0.001 |
|   92 ms |        1133.25 |            -16 |   0.233 |
|  176 ms |         818.76 |            -16 |   0.735 |
|  237 ms |         712.28 |            -16 |   0.908 |
|  360 ms |         653.56 |            -16 |       1 |
|  602 ms |            655 |            -16 |       1 |

The computed `left` property supplied most of that motion: it changed from about
1277.71 px to 640 px. The transform contribution changed only from approximately
`translateX(0)` to `translateX(15px)`, while `translateY(-376px)` stayed constant.
The panel briefly overshot to x ≈ 652.58 before settling at x = 655, matching a
spring rather than a cubic Bézier.

The left panel simultaneously moved from x = 384 to x = 128, overshot to about
x = 107.67, and settled around 600 ms.

On back/exit, the right panel did **not** slide away. It stayed at x = 655 and
y = -16 while fading from opacity 1 to 0 by about 350 ms, then unmounted around
588 ms. The left panel sprang back to center, overshooting to x ≈ 404.69 before
settling at x = 384.

Source: signed-in `poke.com/settings/messaging` DOM and computed styles sampled on
2026-07-26 using the visible Settings → Messaging click path.

### 5. Close is concurrent; the apparent speed comes from front-loaded physics

The close handler inside `ICResponsiveDoubleModalLayout` makes the sequencing
explicit. When the right dialog is open, the handler calls `onLeftOpen()` and
sets the local right-open state to `false` in the same event. In the resulting
React commit:

- the still-mounted left dialog changes from the `openWithRight` variant to the
  centered `open` variant;
- the right dialog leaves `AnimatePresence` and starts `exit: { opacity: 0 }`;
- there is no `await`, timer, `onExitComplete`, or animation-end callback between
  those two state changes.

The primary recenter spring is `stiffness: 400`, `damping: 25`, with the default
mass of 1. The right opacity exit inherits the right dialog's `stiffness: 300`,
`damping: 30` spring transition. The `duration` values present beside these
physics parameters do not describe a fixed-duration CSS easing; the stiffness
and damping define the visible response.

The following values are the response of those shipped spring parameters. The
left coordinates use the signed-in 1280 px capture (`x = 128 → 384`, a 256 px
journey); the right opacity begins at 1. The calculated left overshoot at 200 ms
(`x ≈ 404.69`) agrees with the independently sampled live DOM value, which is a
useful cross-check that the physics model matches the production animation.

| Elapsed | Left recenter progress | Left x | Right opacity |
| ------: | ---------------------: | -----: | ------------: |
|    0 ms |                     0% |  128.0 |         1.000 |
|   50 ms |                  31.8% |  209.4 |         0.772 |
|  100 ms |                  76.8% |  324.6 |         0.439 |
|  133 ms |                  95.9% |  373.5 |         0.271 |
|  150 ms |                 101.9% |  388.8 |         0.204 |
|  200 ms |                 108.1% |  404.7 |         0.077 |
|  250 ms |                 105.6% |  398.4 |         0.021 |
|  300 ms |                 102.0% |  389.0 |       ≈ 0.000 |
|  350 ms |                  99.9% |  383.7 |   0 (clamped) |
|  500 ms |                  99.8% |  383.6 |             0 |

This explains the important perceptual detail: Poke may keep the right node
mounted until the opacity spring reaches its rest threshold, and the left spring
may continue settling for roughly half a second, but neither panel looks slow.
The left dialog is already visually centered in about 145 ms. Right-node unmount
timing must not be used as the trigger for left recentering.

Source: [Poke production application bundle](https://poke.com/vc-ap-d2a57d/main-CtGUTzKH.js),
`ICResponsiveDoubleModalLayout`, plus the signed-in close capture described above.

### 6. Routes inside the dialogs are a separate animation system

Poke places an `ion-router-outlet` with `animated="true"` inside each dialog. Ionic only builds a route animation when there is both an entering and a leaving page. Therefore, the first content painted inside a newly mounted right dialog does not add another route entrance on top of the dialog's horizontal entrance.

For later routes inside an already-open dialog:

- Ionic iOS mode moves entering content from about `99.5%` on the inline axis to `0%` over a default 540 ms and moves the leaving content toward `-33%`.
- Ionic Material/Desktop mode moves entering content from `translateY(40px)` to `translateY(0)` while fading from 0.01 to 1 over 280 ms. A back transition moves the leaving content down 40 px while fading out over 200 ms.

Sources: [Poke-shipped Ionic iOS transition](https://poke.com/vc-ap-d2a57d/ios.transition-BQ_7c4yQ.js) (SHA-256 `47767d6773aa01906ca288ee64977babd99fc12c4d1730f98e76a2dc311b3cf6`) and [Poke-shipped Ionic Material transition](https://poke.com/vc-ap-d2a57d/md.transition-CTYzSZgS.js) (SHA-256 `4280cf82f52588b439bccf8ba2b567c872b58f96e6a666cbfe795da0705336d1`).

This explains how someone can observe a bottom-up animation _inside_ a Poke dialog without the Poke adjacent dialog itself ever entering from the bottom.

## Comparison with the merchant implementation

### Adjacent dialog

The current merchant sidecar entrance now matches Poke's outer geometry:

- start: `left: 100%`, `translate3d(0, -50%, 0)`, opacity 0;
- end: `left: 50%`, `translate3d(15px, -50%, 0)`, opacity 1;
- no vertical travel and no scale change.

Its close keyframe is also opacity-only and holds the paired x/y transform. The
merchant fade is a fixed 180 ms `ease-out`, whereas Poke's opacity inherits the
300/30 spring and becomes effectively invisible around 300–350 ms. This difference
does not explain a slow left recenter because Poke intentionally runs the two
animations independently.

Source: [`apps/merchant/src/index.css`](../../../apps/merchant/src/index.css),
`merchant-desktop-sidecar-enter` and `merchant-desktop-sidecar-exit`.

### Primary dialog

Our primary dialog correctly moves between `translateX(-50%)` and
`translateX(-100%)`. During the sidecar's `closing` state, a relational CSS
rule overrides the still-present `data-desktop-substep-open='true'` transform
and immediately recenters the primary. That means the two outer motions begin
concurrently even though the paired-position attribute remains set until the
sidecar unmounts, matching Poke's visible sequencing.

Before this fix, the merchant's 500 ms CSS `linear()` spring approximation
reached only 68% at 100 ms, 94% at 160 ms, and did not first cross the centered
position until roughly 188 ms. Poke's 400/25 spring is about 77% complete at
100 ms, 96% at 133 ms, and first crosses center around 145 ms. That made the
merchant dialog roughly 40–45 ms late through the most perceptually important
part of the recenter, even though both implementations had a similar half-second
settling tail.

The updated merchant curve samples the analytical 400/25 response at 25–50 ms
intervals: 0.318 at 50 ms, 0.768 at 100 ms, 0.959 near 133 ms, 1.004 near
145 ms, and 1.081 at 200 ms. It therefore keeps the same subtle settling tail
while matching Poke's early travel and overshoot.

| Elapsed | Poke left progress | Previous merchant approximation |
| ------: | -----------------: | ------------------------------: |
|   50 ms |              31.8% |                           ≈ 33% |
|  100 ms |              76.8% |                             68% |
|  133 ms |              95.9% |                           ≈ 83% |
|  150 ms |             101.9% |                           ≈ 89% |
|  160 ms |           ≈ 104.3% |                             94% |
|  200 ms |             108.1% |                        ≈ 104.7% |

The applied fix preserves the concurrent state change and makes the primary curve
equally front-loaded. It does not shorten the sidecar's mount lifecycle as a
workaround; its exit and the primary recenter remain independent, as in Poke.

Source: [`apps/merchant/src/index.css`](../../../apps/merchant/src/index.css),
the `--merchant-desktop-primary-spring`, primary-dialog transition, and
`:has(...[data-desktop-substep-state='closing'])` override rules.

### Inner substeps

Our deeper substep wrapper now animates only the entering view from y = 40 px to
y = 0 while fading from 0.72 to 1. It replaces the previous React subtree
immediately, so there is no simultaneous leaving view.

Source: [`apps/merchant/src/index.css`](../../../apps/merchant/src/index.css), lines 680–695, and [`mobile-new-appointment-sheet.tsx`](../../../apps/merchant/src/components/merchant-shell/mobile/mobile-new-appointment-sheet.tsx), lines 685–695.

Poke's router outlet keeps entering and leaving pages long enough to animate both. On desktop/Material mode its inner forward transition is vertical; on iOS mode it is horizontal. This is a second, separate parity gap after the adjacent-dialog entrance is corrected.

## Why the merchant close felt slow

The lag came from two independent implementation details:

1. The primary's paired-position attribute remains present throughout the
   sidecar exit, so without a closing-state override its return began only after
   the fade and unmount completed.
2. Once it began, the previous merchant `linear()` curve delayed its first center
   crossing until about 188 ms rather than Poke's roughly 145 ms.
3. Both can continue a subtle settling tail for roughly half a second, but that
   tail is not what users perceive as the main movement.
4. Waiting for `animationend` is still appropriate for removing the right node,
   provided that removal is not coupled to the primary transform.

The fix adds a closing-state CSS override that wins over the paired-position
rule and uses the sampled 400/25 curve, so the primary starts immediately and
crosses center at Poke's timing. The attribute is cleared later during the normal
sidecar unmount. The paint-safe `preparing → entering → open` lifecycle is
unrelated to this close lag and remains intact.

## Target behavior for implementation

To match Poke's outer double-dialog choreography:

1. Keep the sidecar's y transform at `-50%` for every state.
2. Remove scale from sidecar enter and exit.
3. Start the sidecar with `left: 100%`, no x offset, and opacity 0.
4. End it at `left: 50%`, x = 15 px, and opacity 1.
5. Animate the primary dialog to x = `-100%` at the same time.
6. Use spring motion comparable to damping 30 / stiffness 300 for the sidecar and damping 25 / stiffness 400 for the primary dialog. For close parity, preserve the primary spring's front-loaded response: about 77% at 100 ms and first center crossing around 145 ms.
7. On closing only the sidecar, start the opacity-only sidecar exit and the primary recenter in the same render. Never wait for the right fade or unmount before moving the primary dialog. Poke does not visibly send the sidecar back offscreen.
8. Keep inner route motion independent. If exact Poke desktop behavior is the goal, preserve both entering and leaving substep views and use the 40 px Material transition for deeper routes.
9. Preserve the current reduced-motion path by applying final poses immediately.
10. Add a browser geometry test, not only a state test: the adjacent dialog's sampled `deltaY` should be approximately zero and its horizontal travel should dominate the entrance vector.

## Confidence

Confidence is high for the outer dialog direction and transforms because the shipped
component, supplied DOM, live entry/exit frame samples, and measured final geometry
agree exactly. Asset hashes are recorded because Poke may deploy new hashed bundles
later.
