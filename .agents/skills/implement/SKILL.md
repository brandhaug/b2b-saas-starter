---
name: implement
description: Implement an agreed issue or spec in this repository through delegated work, independent review, fixes, and a PR verified ready to merge. Use for issue implementation and resuming that workflow.
---

# Implement

Run from the repository root. This is the repository's extension of the personal
`implement` skill. The default endpoint is an open PR ready to merge. An explicit
request for local work, a draft, or another stopping point takes precedence.
Merge only when the user requests it.

## Establish the task

Read `AGENTS.md`, the affected intent nodes, and
[issue-tracker.md](../../../docs/agents/issue-tracker.md). Fetch the complete issue,
comments, and blockers. Resolve conflicts in the specification before dependent
work starts. If the issue is blocked by unfinished work, report that dependency
and continue only independent work within the requested scope.

Use the agreed acceptance criteria as the task list. Preserve existing AC IDs;
assign local IDs for tracking when the source has none. Record the issue URL,
decisions, criterion-to-task mapping, validation evidence, review findings, and
last checked PR SHA in an ignored `.context/implement-<issue-or-slug>.md` file.
This is resumable work state; the issue remains the specification. Reconcile it
with the actual diff and GitHub state when resuming.

For an undecided feature, use the user's grilling workflow first. When the agreed
spec needs several independently verifiable tickets, use `to-tickets` with the
tracker guidance. Do not turn a single implementable issue into extra tickets.
Creating or changing issues follows the user's publishing authorization.

Resolve the base branch and record its SHA and the merge-base. Preserve unrelated
working changes. Use the current task branch when suitable; otherwise create an
isolated branch. If Orca worktree state is involved, use `orca-cli` and its
instructions rather than managing that state through raw worktree commands.

## Route skills and delegate

Read the installed skill instructions before applying them. Route by the work:

| Work                                           | Skills                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| Effect implementation, schemas, errors, tests  | `effect` and [repo examples](../../../docs/agents/effect-examples.md)           |
| New or changed module interfaces               | `codebase-design`                                                               |
| Effect service ownership, dependencies, Layers | `effect-service-design` and `codebase-design`                                   |
| UI design or changes                           | `impeccable`, preserving `DESIGN.md` and its bounded visual verification passes |
| Behavior with a testable seam                  | `tdd`, using observable acceptance outcomes                                     |

If a requested skill is missing, report it. Use a documented equivalent only when
it preserves the task's requirements; do not claim the missing skill ran.

The orchestrator owns the design decisions, shared contracts, integration, and
acceptance. Delegate bounded implementation, investigation, and fixes to Luna
where available. Escalate ambiguous interfaces, security-sensitive policy, or
repeated worker failures to the orchestrator. Report model fallback if Luna is
unavailable. Never trade away required verification to increase delegation.

Each worker brief includes the outcome, AC IDs, owned files, relevant intent nodes
and skills, dependencies, and validation expectations. Assign one writer per
shared file, especially schemas, `layers.ts`, export maps, and lockfiles. Parallel
tasks must be independent; finish shared contract decisions before dispatching
their consumers. In a shared checkout, workers do not commit or run concurrent
installers. The orchestrator integrates and commits.

Workers return changed files, observed test results, AC coverage, and unresolved
questions. The orchestrator inspects the diff and caller integration before
accepting the task. Run focused tests and typechecks during implementation; keep
full validation for the integrated result.

## Review and repair

Commit a validated implementation checkpoint so reviewers can inspect a fixed
diff. Supply the resolved base SHA, reviewed head SHA, full agreed spec, and
standards sources to `code-review`. Its Standards and Spec agents run independently.
Ask the Spec reviewer to cover authorization, cross-workspace access, failure
behavior, and regression cases wherever relevant. Keep the two reports separate.

Spawn an independent maintainability reviewer with
`thermo-nuclear-code-quality-review`, plus `effect`, `effect-service-design`, or
`codebase-design` where applicable. Use read-only reviewers with fresh context;
provide source evidence rather than the implementation agent's self-assessment.

Every finding needs a location, governing rule or AC, consequence, and evidence.
The orchestrator records its disposition: fix, reject with evidence, or defer with
reason. Heuristic redesign suggestions need a demonstrated benefit before they
become work. Missing acceptance behavior and confirmed defects block completion.

Delegate accepted fixes with non-overlapping ownership. Verify the relevant
behavior and have an independent reviewer check the repaired portions and their
integration. Review evidence applies only to the recorded SHA; later changes need
review proportional to their impact. Re-run affected checks after fixes, and full
validation when integration or application behavior changed. Never relax tests,
coverage thresholds, or required checks to obtain a green result.

Once criteria and accepted findings have evidence, continue with
[PR completion](references/pr-completion.md). Report an external blocker when
progress requires credentials, unavailable infrastructure, or a user decision.
Bound retries of the same external failure; waiting is not evidence of success.
