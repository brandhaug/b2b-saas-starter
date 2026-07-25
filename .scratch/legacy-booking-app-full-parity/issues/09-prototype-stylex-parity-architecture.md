# Prototype the StyleX Parity Architecture

Type: prototype
Status: resolved
Blocked by: 02, 03, 04

## Question

What StyleX theme, primitive, component-variant, responsive, animation, asset, and escape-hatch architecture can reproduce a representative high-complexity legacy journey pixel-for-pixel without recreating the legacy styled-components coupling?

## Comments

- A runnable throwaway artifact and provisional architecture are ready for human evaluation: [StyleX Parity Architecture Prototype](../prototypes/stylex-parity-architecture.md). The ticket remains claimed because a prototype is HITL and cannot resolve before the human verdict.

## Answer

The human accepted the prototype as validation of the architecture seams, with an explicit distinction: the invented prototype UI is not visual-parity evidence and does not resemble the legacy source closely enough to serve as a baseline. Pixel-for-pixel acceptance remains owned by the reproducible legacy captures and parity verification harness.

The accepted architecture is recorded in [StyleX Parity Architecture Prototype](../prototypes/stylex-parity-architecture.md): a dedicated `bookingTheme` variable group; premium branding applied once at the booking boundary; semantic, typed primitive variants instead of styled-system or arbitrary style props; a centered full-height 375px viewport owner; StyleX for static and interaction states; focused motion wrappers for coordinated presence/layout choreography; and named semantic overlay layers preserving legacy order.

Runtime tenant imagery and validated merchant palette values are allowed only as boundary-level escape hatches. Component-level arbitrary colors, spacing, and style objects are rejected. Constrained token-backed layout props may be added only where repeated legacy compositions demonstrate a real primitive need.

The prototype also proved the repository-specific mechanics: StyleX variable definitions must live in `.stylex.ts` modules; URL-selected prototype state must synchronize after SSR to avoid hydration mismatches; and the 375px viewport contract can remain centered without desktop overflow. Typecheck, client/SSR build, browser inspection, direct-link hydration, and React Doctor passed before the throwaway code was deleted.
