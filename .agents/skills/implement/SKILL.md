---
name: implement
description: Implement an agreed issue or spec through implementation, review, fixes, and a PR ready to merge.
---

# Implement

Default endpoint: a reviewed PR ready to merge, without merging. Honor a narrower
user request.

1. Read the issue and comments using [tracker guidance](../../../docs/agents/issue-tracker.md).
   Keep issue numbers and acceptance-criteria (AC) IDs only in GitHub issue/PR
   traceability. Use descriptive behavioral names in repository code, docs,
   comments, test titles, filenames, and other tracked implementation content;
   never embed issue numbers or AC IDs there. Preserve legitimate external
   dependency references and unrelated numeric values. Map criteria to test
   evidence in the PR. Use `grilling` for unresolved product decisions and
   `to-tickets` for independently verifiable slices.
2. Implement in the main session by default. The session already holds the issue,
   the grilling, and the plan; a worker briefed from a summary loses that context
   and produces worse fixes. Delegate implementation only when the change has two
   or more independent file boundaries and parallel work saves wall-clock. Then
   give each worker the full issue text, the agreed spec, and its owned files, not
   a compact brief. Assign one writer to shared wiring. Keep the session model for
   implementation and review. Use a configured cheaper same-provider model only
   for the browser verifier, where the contract is narrow and pass/fail.
   Keep the session's provider unless the user requests a switch.
   The main session alone dispatches reviews and includes this ownership rule in
   any worker brief. Implementers and reviewers do not dispatch additional reviewers.
   If delegation is unavailable, review locally and report that review was not
   independent.

   When delegating, start workers with fresh context using the active tool schema:

   - Codex: set `fork_turns: "none"` when exposed; its default can inherit the
     full conversation. If the tool exposes `fork_context` instead, set it to `false`.
   - Claude Code: start a new `Agent` with `subagent_type: "general-purpose"`
     or a configured non-fork subagent. These start fresh; `fork` copies history.
   - OpenCode: start a new `task` with a compact `prompt` and omit `task_id`.
     Supplying `task_id` resumes an existing worker's context.

   Resume an existing worker when continuing its assigned task.

3. Apply `effect` with [repo examples](../../../docs/agents/effect-examples.md),
   `codebase-design` for module interfaces, `effect-service-design` for service
   ownership/Layers, and `impeccable` for UI. Use `tdd` at agreed behavior seams.
   If a supporting skill is missing, follow [skills setup](../../../docs/agents/skills.md).
4. Docs and mechanical edits get one targeted reviewer. For behavior changes, use
   `code-review` against a fixed base/head and the agreed spec, with its separate
   Standards and Spec reviewers. The Standards reviewer applies
   `thermo-nuclear-code-quality-review` in the same pass and deduplicates overlapping
   findings. Keep Spec independent; run a separate deep audit only on explicit request.
5. Consolidate findings before assigning fixes. Structural suggestions need a
   concrete benefit. Apply accepted repairs in the main session; if a worker owns
   the affected files, resume that worker with the full findings rather than a
   summary. Re-review the full diff against base, not only the repair hunks; the
   reviewer is fresh either way and a partial view hides regressions. If two repair
   rounds fail, stop and reassess the cause in the main session, then report the
   unresolved blockers. Repeat the broader review only when design or behavior
   changes substantially.
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
