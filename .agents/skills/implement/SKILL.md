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
   session's provider unless the user requests a switch. For bounded implementation,
   review, and browser work, prefer GLM 5.3 → GLM 5.3 Flash, Claude Opus → Sonnet,
   Codex Astra → Luna. Resolve these pairings through the host's configured model
   IDs or worker profiles and select the worker model explicitly. For other models,
   use a configured cheaper same-provider model. Inherit the session model only
   after checking that no suitable worker model is available, and report the fallback.
   Keep coordination and final decisions in the main session. If delegation is
   unavailable, work locally and report that review was not independent.
   Give workers compact briefs with ACs, owned files, and relevant pointers.
   Start with fresh context where supported; include conversation history only
   when the task depends on it. Keep tiny tasks local. Default to one implementation
   worker; add workers for independent file boundaries. Assign one writer to shared wiring.
   The coordinator alone dispatches reviews and includes this ownership rule in
   worker briefs. Implementers and reviewers do not dispatch additional reviewers.

   Use the context controls exposed by the active tool schema:

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
   concrete benefit. Send accepted repairs back to the original implementer. Re-review
   only accepted findings plus the repair diff and affected callers. If two repair
   rounds fail, reassess the cause. Supply missing context or use a fresh worker on
   a more capable configured same-provider model, carrying prior attempts and open
   findings. If that repair still fails, report the unresolved blockers and stop
   repair dispatch. Repeat the broader review only when design or behavior changes
   substantially.
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
