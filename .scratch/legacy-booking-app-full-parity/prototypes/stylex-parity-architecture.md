# StyleX Parity Architecture Prototype

## Question

Can a dedicated StyleX theme, typed semantic variants, responsive primitives, animation/layer contracts, asset boundaries, and narrow escape hatches reproduce a representative high-complexity legacy journey without recreating styled-components coupling?

## Run

```bash
bun --cwd apps/booking dev
```

Open `http://localhost:3073/prototype-stylex-parity?variant=selection`.

The development-only switcher and left/right arrow keys move between:

- `selection` — dense cards, selected/disabled/compact semantic variants, sticky chrome, and the 375px viewport contract.
- `schedule` — horizontally constrained date choices, time selection, and explicit held-slot state.
- `overlay` — a premium `createTheme` override, backdrop/sheet/toast layer ordering, scroll ownership, and 150/300ms motion tokens.

## Provisional architecture demonstrated

- A dedicated `bookingTheme` variable group owns semantic colors, timings, and named layers; tenant branding is a theme override applied once at the booking boundary.
- StyleX variable definitions live in `.stylex.ts` modules, a compile-time requirement discovered by the prototype.
- Components consume semantic primitive states (`selected`, `disabled`, `compact`) instead of accepting arbitrary style objects or rebuilding styled-system props.
- Static and interaction styling belongs to StyleX. Coordinated presence/layout choreography can remain behind motion wrappers; the prototype uses CSS keyframes only to prove token and layer seams.
- The widget boundary owns the full-height, centered 375px contract. Component overflow is local and deliberate.
- Runtime tenant imagery is the proposed narrow inline-style escape hatch; arbitrary colors, spacing, and component overrides are not.

## Verification evidence

- `bun --cwd apps/booking typecheck` passes.
- `bun --cwd apps/booking build` passes for client and SSR.
- React Doctor reports 100/100 with no issues.
- Browser inspection at 375×812 verified all three states, URL-stable switching, disabled semantics, the modal/dialog tree, and layer rendering.
- Browser inspection at 1024×768 measured a 375px widget at `left: 324.5px` with no horizontal overflow.
- A direct `?variant=schedule` navigation hydrates without a React mismatch and resolves to the requested state.

## Human verdict

Accepted on 2026-07-11 as an architecture-validation prototype. It was explicitly not accepted as evidence of visual similarity to the legacy Booking App: its UI was invented to stress the seams, while pixel parity remains governed by the reproducible legacy baseline and parity verification harness.

The accepted direction is a dedicated StyleX booking theme, semantic component variants, a 375px viewport boundary, named overlay layers, and a split where StyleX owns static/state styling while focused motion wrappers own coordinated presence and layout choreography. Runtime tenant imagery and validated tenant palette values are boundary-level escape hatches; arbitrary component style objects are not. Layout primitives may expose only constrained, token-backed spacing and alignment props where repeated legacy composition proves the need.

The throwaway route and components were deleted after this verdict; this document retains the findings.
