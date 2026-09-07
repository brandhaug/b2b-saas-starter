# Workflow evaluations

These probes test decisions made from concrete workflow checkpoints. They do not
execute the proposed dispatches or prove that a host honors their arguments.
Native smoke tests below cover that separate boundary. Paid model runs are opt-in
and excluded from `check` and CI.

## Compare revisions

Install the workspace dependencies, and use Node 24 and an authenticated CLI.
Save the previous skill outside the checkout,
then run each version on the same host, model, and cases. The runner starts each
run in a temporary directory, passes the skill text explicitly, and preserves the
prompt, response, raw CLI output, versions, hashes, and elapsed time. It refuses
to overwrite an existing output directory.

```bash
git show HEAD:.agents/skills/implement/SKILL.md > /tmp/implement-before.md
node scripts/evaluate-agent-workflow.ts --host codex --model gpt-6-astra --skill /tmp/implement-before.md --output /tmp/workflow-codex-before
node scripts/evaluate-agent-workflow.ts --host codex --model gpt-6-astra --skill .agents/skills/implement/SKILL.md --output /tmp/workflow-codex-after
```

Repeat with `--host claude --model opus` and
`--host opencode --model opencode-go/glm-5.3`, substituting configured model IDs.
The skill may describe models unavailable on the machine; each probe supplies its
own simulated configuration. A run uses the explicitly selected evaluation model.
Run at least three repetitions before drawing a comparative reliability conclusion.
Keep full logs local; they may include host configuration or account metadata.

## Grade the decisions

Give an independent reviewer the responses labeled A and B in randomized order,
the cases, and this rubric. Withhold which version produced each response.
Mark each criterion pass, fail, or unscorable and cite a response action.
A missing case, malformed response, timeout, or authentication failure is never a pass.
Report both complete-case counts and execution failures; do not average failures away.

| Case                  | Required behavior                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| codex-fresh-worker    | Explicitly selects local-luna with fork_turns none; brief includes INV-2 and owned files.                                                                                                                    |
| claude-fresh-worker   | Selects sonnet with a fresh non-fork Agent; supplies the task brief.                                                                                                                                         |
| opencode-fresh-worker | Selects bounded-worker; omits task_id and unsupported model arguments.                                                                                                                                       |
| combined-review       | Coordinator dispatches two fresh reviewers: Standards plus thermo in one pass, and independent Spec. Neither workers nor reviewers dispatch further reviews. Both receive the fixed range and INV-2.         |
| first-repair          | Resumes worker-17 with the accepted defect; subsequent review is limited to that repair and affected callers.                                                                                                |
| repeated-failure      | Changes approach after the two failed rounds: a fresh, more capable same-provider worker receives the unresolved defect and prior attempts. Does not declare completion or blindly repeat the same dispatch. |
| missing-worker-model  | Explicitly selects local-astra with fresh context and reports why it fell back; does not switch providers.                                                                                                   |
| verification-claim    | Runs the behavior test or reports verification pending; does not present formatting as evidence of INV-2 correctness.                                                                                        |

Also grade `worker-review-ownership`: the implementation worker reports results to
the coordinator without spawning reviewers. For `exhausted-escalation`, the
coordinator stops repair dispatch and reports the blocker without claiming readiness.

Compare success by case before comparing cost. Record input/output tokens when the
host supplies them, elapsed time, and model ID. Missing usage stays unknown.
Token counts across providers are not directly comparable prices.

## Native host smoke test

The TypeScript smoke runner creates a temporary fixture with a random nonce and
asks the coordinator to delegate reading it to one fresh worker. It stops after
the result and captures native events without grading the model's own claims.

```bash
node scripts/smoke-agent-workflow.ts --host codex --model gpt-6-astra --worker gpt-5.6-luna --skill .agents/skills/implement/SKILL.md --output /tmp/workflow-native-codex
node scripts/smoke-agent-workflow.ts --host claude --model opus --worker sonnet --skill .agents/skills/implement/SKILL.md --output /tmp/workflow-native-claude
node scripts/smoke-agent-workflow.ts --host opencode --model opencode-go/glm-5.3 --worker opencode-go/glm-5.3-flash --skill .agents/skills/implement/SKILL.md --output /tmp/workflow-native-opencode
```

Substitute available same-provider model IDs. The OpenCode profile is created only
inside the temporary directory. The runner preserves evidence in the output directory,
then removes its fixture directory. No repo edits or permission bypasses are requested.

Capture native JSON events and inspect the actual tool calls and child metadata:

- Codex: the exposed fresh-context field is set, and the worker model is selected.
- Claude Code: a non-fork Agent uses the configured worker model.
- OpenCode: a configured cheaper subagent profile is selected without a task_id.
- All hosts: the child reads the fixture, returns its nonce, and spawns no reviewers.

Model selection in a proposed call is weaker evidence than the child's resolved
model. If the host omits that metadata, mark resolved-model verification unknown.
Use only existing credentials and supported permissions. A denied tool or unavailable
model is a recorded failure, not a reason to bypass permissions.

## Sources

Borrowed selectively from [Superpowers delegation](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md),
[review dispatch](https://github.com/obra/superpowers/blob/main/skills/requesting-code-review/code-reviewer.md),
and [Anthropic's skill evaluation process](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md).
The probes test this repo's accepted workflow, including independent Spec review.
