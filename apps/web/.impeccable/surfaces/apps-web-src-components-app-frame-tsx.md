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

User-pinned layout: narrow icon rail; workspace navigation sidebar; related route tabs; main task content; bottom bar. After reviewing the implementation, the user asked to remove the permanent right panel and reserve it for drawers and sheets opened on demand. Keep Catppuccin Mocha, Geist and existing shadcn Base UI controls. Code-led implementation of a schematic, no illustrative assets needed.

## First viewport

At 1440px: 60px rail, 220px sidebar, flexible main task column. Fine borders define the full-height regions. Route tabs open the main column. The overview opens its onboarding checklist from a page-header action in a right-side sheet. Other pages retain their actual content without generic context panels.

## Interaction

Navigation retains active states and keyboard focus. Related-route tabs are semantic links; content tabs keep existing keyboard behavior. Search uses the existing command palette. Below desktop, navigation moves into the existing sheet; all actions remain reachable. Setup is closed initially, fits mobile, and restores trigger focus when closed with Escape.

## Evidence and constraints

Capture before and after for every changed route and tab on desktop/mobile. No invented statistics. No auth or capability changes. Verify navigation, preview refusal, mobile overflow, required checks, and independent review. No unresolved design choice.
