---
name: implement
description: Implement an agreed issue or spec through implementation, review, fixes, and a PR ready to merge.
---

# Implement

Default endpoint: a reviewed PR ready to merge, without merging. Honor a narrower
user request.

1. Read the issue and comments using [tracker guidance](../../../docs/agents/issue-tracker.md).
   Preserve AC IDs through tests and the PR. Use `grilling` for unresolved product
   decisions and `to-tickets` for independently verifiable slices.
2. Use the host's available delegation tools and configured model IDs. Keep the
   session's provider unless the user requests a switch. Use a cheaper same-provider
   model for bounded implementation, review, and browser work when available;
   otherwise inherit the session model. Keep coordination and final decisions in
   the main session. If delegation is unavailable, work locally and report that
   review was not independent.
   Give workers compact briefs with ACs, owned files, and relevant pointers.
   Start with fresh context where supported; include conversation history only
   when the task depends on it. Keep tiny tasks local. Default to one implementation
   worker; add workers for independent file boundaries. Assign one writer to shared wiring.
3. Apply `effect` with [repo examples](../../../docs/agents/effect-examples.md),
   `codebase-design` for module interfaces, `effect-service-design` for service
   ownership/Layers, and `impeccable` for UI. Use `tdd` at agreed behavior seams.
   If a supporting skill is missing, follow [skills setup](../../../docs/agents/skills.md).
4. Docs and mechanical edits get one targeted reviewer. For behavior changes, use
   `code-review` against a fixed base/head and the agreed spec, with its separate
   Standards and Spec reviewers. Apply `thermo-nuclear-code-quality-review` for
   concrete architectural concerns or an explicit request.
5. Consolidate findings before assigning fixes. Structural suggestions need a
   concrete benefit. Independently recheck accepted repairs and affected callers;
   repeat the broader review only when design or behavior changes substantially.
6. For UI acceptance gaps, use available browser tooling to run one smoke path.
   Give the verifier the URL, credential source, actions, expected visible outcomes,
   and a limit of 12 browser actions. Stop on the first failure and return pass/fail
   evidence; gather screenshots or console/network diagnostics as needed.
   Prefer existing Playwright coverage for regression checks. If browser tooling
   is unavailable, report the unverified acceptance criteria.
7. Run focused checks during work and `pnpm run validate` on the integrated result.
   Commit and create/update the PR using the repo template.
8. Run `gh pr checks --required --watch` with a 30-minute deadline per head.
   Fix actionable failures and reverify after pushes. Before finishing, confirm
   the same head satisfies required checks/reviews and is up to date with and
   mergeable against the base. Report optional failures and external blockers.
