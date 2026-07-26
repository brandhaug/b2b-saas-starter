# Poke desktop Integrations dialog routing

Date captured: 2026-07-26
Scope: desktop Integrations list → integration detail → back → another detail.
Method: signed-in Poke UI inspection at desktop width, using only first-party
`poke.com` routes and the rendered DOM. Local comparison is against the Merchant
App dialog host in this repository. No secondary sources were used.

## Executive finding

Poke does **not** close and reopen the Integrations dialog when the selected
integration changes. It keeps one fixed outer dialog mounted and performs route
navigation inside that dialog:

- the URL changes for list and detail routes;
- the outer dialog retains the same DOM identity, open state, style, and title;
- only the content rendered by the inner animated router outlet changes.

The important architectural boundary is therefore **dialog host versus dialog
route content**. Poke owns the host above the integration routes. A route change
updates the host's outlet; it does not recreate the host.

## Signed-in route sequence

The following clicks were performed through the visible Poke UI:

| Step                      | URL                                                                                                                                        | Settled content   | Outer dialog result |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------------------- |
| Integrations list         | [`https://poke.com/integrations`](https://poke.com/integrations)                                                                           | Integration cards | Root mounted        |
| Click GitHub              | [`https://poke.com/integrations/9f0cedaf-25c0-4828-b53e-d5b4cbbc6e89`](https://poke.com/integrations/9f0cedaf-25c0-4828-b53e-d5b4cbbc6e89) | GitHub detail     | Same root           |
| Click detail back control | [`https://poke.com/integrations`](https://poke.com/integrations)                                                                           | Integration cards | Same root           |
| Click Vercel              | [`https://poke.com/integrations/bba5b87b-e2d4-4516-80e3-c85bf73c61fe`](https://poke.com/integrations/bba5b87b-e2d4-4516-80e3-c85bf73c61fe) | Vercel detail     | Same root           |

These are first-party Poke route URLs observed after UI clicks, rather than
programmatic redirects.

## DOM evidence

At every settled point in the sequence above, the outer root was the same
element:

```text
div[role="dialog"]
id="radix-:rm:"
data-state="open"
```

Its fixed-position presentation also remained unchanged:

```css
position: fixed;
top: 50%;
left: 50%;
transform: translate(-50%, -50%);
transition: 0.2s ease-out;
pointer-events: auto;
```

The class list includes the root open/close fade-and-zoom animation classes, but
those root classes and the root `data-state="open"` did not restart while moving
between the list, GitHub, the list again, and Vercel. The accessible root heading
also remained `Integrations` while a detail route was active.

Poke used no native modal element for this surface:

```text
document.querySelectorAll('dialog').length === 0
document.querySelectorAll(':modal').length === 0
```

The changing region was a descendant outlet:

```html
<ion-router-outlet
  animated="true"
  class="flex min-h-0 grow flex-col gap-2"
></ion-router-outlet>
```

The outlet returned the list structure after the back click and the appropriate
detail structure after each card click. At each settled observation, only one
active detail/list wrapper was present in the outlet.

## Motion and navigation model

### Verified

1. The root dialog's DOM node persists across list/detail route changes.
2. Root open state, fixed transform, and title persist.
3. URLs change to real child routes and back to the list route.
4. The changing page is rendered under `ion-router-outlet animated="true"`.
5. Root fade/zoom is reserved for opening or closing the whole Integrations
   surface; it does not replay for an internal integration selection.

### Inferred, not directly frame-sampled in this pass

The `animated="true"` outlet establishes a separate inner route-animation layer.
Poke's already-captured desktop Ionic/Material behavior uses an entering page
that rises about 40 px while fading in, with a distinct back transition. That is
consistent with the Integrations outlet structure, but this pass did not capture
overlapping entering/leaving wrappers frame by frame. Likewise, focus restoration
to the originating integration card after back was not directly measured, so it
should not be treated as a verified Poke behavior from this capture.

Related first-party bundle analysis and frame measurements are recorded in
[`poke-desktop-double-dialog-motion.md`](./poke-desktop-double-dialog-motion.md),
especially the section on routes inside an already-open dialog.

## Comparison with the Merchant App

### Previous failure mode

The Merchant App previously let each sibling route own its own
`MerchantShell`/`DesktopRouteModal`. Navigating from one overlay route to another
therefore unmounted one dialog and mounted a new one. The replacement modal began
again in its `entering` state and invoked `showModal()`, which visually read as
the dialog closing and reopening.

That ownership differed from Poke: the route leaf owned the shell, rather than a
persistent outlet owning the shell.

### Poke-aligned host boundary

The Poke-aligned structure is:

```text
root application outlet
└── one persistent desktop dialog host
    ├── persistent header / modal state
    └── keyed inner route view
        └── current route leaf content
```

In the Merchant App, the persistent host belongs in
[`merchant-mobile-sheet-outlet.tsx`](../../../apps/merchant/src/components/merchant-mobile-sheet-outlet.tsx),
above sibling route leaves. Route-level
[`merchant-shell.tsx`](../../../apps/merchant/src/components/merchant-shell/merchant-shell.tsx)
should contribute content and route metadata when that host is active, rather
than render another `DesktopRouteModal`.

The outer host in
[`desktop-shell.tsx`](../../../apps/merchant/src/components/merchant-shell/desktop/desktop-shell.tsx)
can then keep its dialog node and `open` lifecycle stable while a keyed inner
wrapper animates content for `location.pathname`. This mirrors Poke's separation
between the persistent fixed dialog and its animated Ionic outlet.

## Acceptance criteria for parity

1. Navigating between sibling desktop overlay routes retains strict DOM identity
   for `.merchant-desktop-modal`.
2. Exactly one outer modal host remains open during the transition.
3. The outer modal does not return to `data-desktop-modal-state="entering"`.
4. Header/title and route body update without replaying root fade/scale.
5. Internal route motion is applied only to the content wrapper.
6. A regression test navigates between at least two sibling routes and asserts
   `updatedDialog === originalDialog`.
7. Closing the overlay still closes the persistent host once and returns to the
   appointments home.

## Confidence and limits

Confidence is high that Poke keeps one outer dialog mounted: route URLs, root DOM
identity, root state/style, title, and outlet content all agreed across four UI
navigation steps. Exact inner animation timing and focus restoration are outside
the verified scope of this capture and are explicitly separated from the direct
observations above.
