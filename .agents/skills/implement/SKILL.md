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
   a compact brief. Pass saved spec paths rather than pasting the implementation
   conversation. Assign one writer to shared wiring and preserve others' edits.
   Keep the session model for implementation. Follow repository reviewer-model
   policy; otherwise use a configured cheaper same-provider model for targeted
   documentation review and browser verification. Keep the session model for
   behavior review unless the repository explicitly selects another model.
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

   Resume an existing implementation worker when continuing its assigned task.
   Keep reviewer contexts fresh, with diff/spec/rule/check-evidence paths and access
   to surrounding source. Where supported, expose only the role's required tools;
   do not assume tool restrictions remove inherited catalogs.

   Locate files before reading bounded ranges. Reuse unchanged guidance already in
   context. Save full command output to logs and return exit status plus relevant
   excerpts; expand the read when understanding the code requires it.

3. Apply `effect` with [repo examples](../../../docs/agents/effect-examples.md),
   `codebase-design` for module interfaces, `effect-service-design` for service
   ownership/Layers, and `impeccable` for UI. Follow the
   [root testing policy](../../../AGENTS.md#testing) when choosing tests and
   implementation order.
   If a supporting skill is missing, follow [skills setup](../../../docs/agents/skills.md).
4. Finish related implementation, tests and docs before dispatching review. Run
   the affected format/lint/type checks and required focused tests first; fix
   actionable failures and save a compact summary with commands, revision, results
   and log paths. Reuse results only while inputs, tool versions and environment
   match. Preserve blockers as unverified work. Docs and mechanical edits get one
   targeted reviewer. For behavior changes, use
   `code-review` against a fixed base/head and the agreed spec, with its separate
   Standards and Spec reviewers. The Standards reviewer applies
   `thermo-nuclear-code-quality-review` in the same pass and deduplicates overlapping
   findings. Include official-SDK selection in Standards: for new or extended vendor
   HTTP calls, verify the existing adapter or official SDK's exact operation, package
   version and runtime fit against fetched vendor docs. Flag duplicated transport,
   auth, pagination or response types when the SDK covers them without a concrete
   constraint. Unsupported endpoints, runtime incompatibility or demonstrated bundle
   constraints can justify narrow HTTP adapters. Report unavailable verification;
   SDK preference alone is not a correctness blocker. Keep Spec independent; run
   a separate deep audit only on explicit request.
5. Consolidate findings before assigning fixes. Batch related accepted repairs
   before another review round; avoid concurrent rounds on a changing snapshot.
   Structural suggestions need a concrete benefit. Apply accepted repairs in the main session; if a worker owns
   the affected files, resume that worker with the full findings rather than a
   summary. Use the repository's incremental-review mechanism when one exists,
   retaining the whole-branch diff as context and obeying its full-review fallback.
   Otherwise re-review the full diff against base. Reuse an unchanged completed
   review only when its scope, spec and standards still match; changed inputs
   require renewed review. If two repair rounds fail, stop and reassess the cause in the main session, then report the
   unresolved blockers. Repeat the broader review only when design or behavior
   changes substantially.
6. For UI acceptance gaps, use available browser tooling to run one smoke path.
   Give the verifier the URL, credential source, actions, expected visible outcomes,
   and a limit of 12 browser actions. Stop on the first failure and return pass/fail
   evidence; gather screenshots or console/network diagnostics as needed.
   Prefer existing Playwright coverage for regression checks. If browser tooling
   is unavailable, report the unverified acceptance criteria.
7. Run `pnpm run check` before committing and `pnpm run validate` on the integrated
   result before PR handoff. Save repeatable E2E evidence per the root testing policy.
   Reuse current results when unchanged; fixes from validation return through affected
   checks and review. Commit and create/update the PR using the repo template.
8. When the host exposes a PR watcher, the parent handles existing failures/comments,
   registers the watch, and ends the turn. Resume on events; stop watching before
   handoff. Do not launch a competing polling agent. Without a host watcher, run
   `gh pr checks --required --watch` with a 30-minute deadline per head.
   Fix actionable failures and reverify after pushes. Before declaring readiness,
   confirm required checks/reviews and mergeability for the current head. Report
   pending checks, optional failures and external blockers accurately.

When measuring cost, record per-PR models, review rounds and retry reasons. Separate
uncached input, cache writes, cached input and output; include child usage and mark
missing counters unknown. Deduplicate streamed usage and avoid counting reasoning
tokens twice when they are part of output. Compare with CI repairs, human-review
findings and regressions before changing quality gates. Token totals are not bills.
