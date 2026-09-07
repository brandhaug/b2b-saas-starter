---
name: implement
description: Implement an agreed issue or spec through delegated work, proportionate independent review, fixes, and a PR ready to merge.
---

# Implement

Default endpoint: a reviewed PR ready to merge, without merging. Honor a narrower
user request.

1. Read the issue and comments using [tracker guidance](../../../docs/agents/issue-tracker.md).
   Preserve AC IDs through tests and the PR. Use grilling for unresolved product
   decisions and `to-tickets` for multiple independently verifiable slices.
2. Keep the active session's provider stable across orchestration, review, and workers,
   regardless of host application. Use the main model for orchestration and final
   synthesis, and a configured cheaper sibling for bounded work:
   GLM 5.3 → GLM 5.3 Flash, Claude Opus → Sonnet, Codex Astra → Luna.
   Resolve names through the host's configured aliases; inherit the main model only
   when a same-provider worker is unavailable. Switch providers only on user request.
   Delegate complete tasks with compact briefs containing ACs, owned files, and
   relevant context pointers. Use `fork_turns: none` by default; never fork the
   full conversation unless the worker needs that exact context. Settle shared
   interfaces once and assign one writer to shared wiring. Keep tiny tasks local.
   Default to one implementation worker, adding a second only for genuinely
   independent file boundaries.
3. Apply `effect` with [repo examples](../../../docs/agents/effect-examples.md),
   `codebase-design` for module interfaces, `effect-service-design` for service
   ownership/Layers, and `impeccable` for UI. Use `tdd` at agreed behavior seams.
4. Docs and mechanical edits get one targeted reviewer. Ordinary behavior changes
   get one reviewer using both Standards and Spec lenses against a fixed base/head.
   Use separate independent reviewers only for high-risk auth, billing, persistence,
   or cross-package changes. Review workers use the cheaper sibling by default;
   the main model adjudicates findings and owns the final repair decision. Fold
   `thermo-nuclear-code-quality-review` into the Standards lens when needed.
   Reserve a separate deep audit for a concrete architectural concern or explicit request.
5. Consolidate overlapping findings and triage before assigning fixes. Structural
   suggestions need a concrete benefit. Independently recheck accepted repairs
   and affected callers; repeat the broader review only when design or behavior
   changes substantially.
6. Run focused checks during work and `pnpm run validate` on the integrated result.
   Save verbose logs to files; read summaries and relevant failures. Commit and
   create/update the PR using the repo template.
7. For UI acceptance gaps, delegate a bounded browser smoke test to Luna. Give it
   the exact URL, credential source, actions, expected visible outcomes, and a
   maximum of roughly 8–12 browser actions. It should stop on the first failure,
   return concise pass/fail evidence, and use screenshots or console/network
   diagnostics only when needed. Prefer Playwright for repeatable regression coverage.
8. Run native `gh pr checks --required --watch` as a process with a 30-minute
   deadline per head; inspect completion or failure rather than reasoning over
   every poll. Fix actionable failures and reverify after pushes. Before finishing,
   confirm the same head satisfies required checks/reviews and is up to date with
   and mergeable against the base. Report optional failures and stalled or external
   blockers separately.
