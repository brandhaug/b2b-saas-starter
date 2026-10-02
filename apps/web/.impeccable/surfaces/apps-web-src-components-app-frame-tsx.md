---
version: 1
slug: 'apps-web-src-components-app-frame-tsx'
primary_target: 'apps/web/src/components/app-frame.tsx'
related_targets:
  [
    'apps/web/src/components/workspace-shell.tsx',
    'apps/web/src/components/preview-shell.tsx'
  ]
---

# Application frame

## Scope and mode

Operate. Workspace, account, system admin, and public demo only. Public showcase and credential pages keep their layouts.

## Context

Members navigate existing workspace tasks and account settings. Retain permissions, preview isolation, routes, content, and mobile actions. User supplied a labeled wireframe and confirmed existing dark palette.

## Direction

User-pinned six-region layout: narrow icon rail; workspace navigation sidebar; related route tabs; main task content; contextual right sidebar; bottom bar. Keep Catppuccin Mocha, Geist and existing shadcn Base UI controls. Code-led implementation of a schematic, no illustrative assets needed.

## First viewport

At 1440px: 60px rail, 220px sidebar, flexible central task column, 264px contextual column. Fine borders define the full-height regions. Route tabs open the center column. The overview's real onboarding checklist moves to the right column. Other pages retain actual content and gain scope/support context.

## Interaction

Navigation retains active states and keyboard focus. Related-route tabs are semantic links; content tabs keep existing keyboard behavior. Search uses the existing command palette. Below desktop, navigation moves into the existing sheet and context follows main content; all actions remain reachable.

## Evidence and constraints

Capture before and after for every changed route and tab on desktop/mobile. No invented statistics. No auth or capability changes. Verify navigation, preview refusal, mobile overflow, required checks, and independent review. No unresolved design choice.
