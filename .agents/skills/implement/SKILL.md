---
name: implement
description: Implement an agreed issue or spec through delegated work, independent review, fixes, and a PR ready to merge.
---

# Implement

Default endpoint: a reviewed PR ready to merge, without merging. Honor a narrower
user request.

1. Read the issue and comments using [tracker guidance](../../../docs/agents/issue-tracker.md).
   Keep its AC IDs through implementation, tests, and the PR. Use the user's
   grilling workflow for unresolved product decisions and `to-tickets` when the
   agreed work needs multiple independently verifiable slices.
2. Use a frontier model for orchestration and review; delegate bounded
   implementation and fixes to Luna unless the user chooses otherwise. Give each
   worker its ACs, owned files, and relevant intent nodes. Assign one writer to
   shared contracts and wiring; the orchestrator integrates.
3. Apply `effect` with [repo examples](../../../docs/agents/effect-examples.md),
   `codebase-design` for module interfaces, `effect-service-design` for service
   ownership/Layers, and `impeccable` for UI. Use `tdd` at agreed behavior seams.
4. Review a fixed base/head revision with `code-review` and the agreed spec.
   Separately delegate `thermo-nuclear-code-quality-review` with applicable
   design/Effect skills. Keep Standards and Spec findings separate. Triage
   findings before dispatching fixes; structural suggestions need a concrete
   benefit. Have an independent reviewer verify accepted repairs.
5. Run focused checks during work and `pnpm run validate` on the integrated
   result. Commit and create/update the PR using the repo template.
6. Delegate a read-only watcher using `gh pr checks --required --watch`. Give it
   the PR URL, expected head SHA, and a 30-minute deadline per head. At expiry,
   report pending checks or external blockers. The orchestrator fixes actionable
   failures and restarts verification after each push.
7. Before finishing, verify that the same head has passing required checks,
   satisfies review requirements, and is up to date with and mergeable against the base.
   Report optional check failures separately. A ready report applies to that
   revision only.
