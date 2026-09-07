<!--
Write for a reviewer with no access to the agent conversation. Describe the final
diff; refresh this body after scope changes or new validation. Scale detail to
the change. Replace prompts with evidence and remove these comments.

Use a Conventional Commit title: type(scope): subject. Follow the root AGENTS.md
and the intent nodes for changed areas; those files own repository policy.
-->

## Outcome

<!--
Link the issue/spec, or state the requested outcome if there is no issue.
Explain the problem and resulting behavior, with a before/after example when useful.
Account for each acceptance criterion with evidence below or an explicit gap.
-->

## Decisions

<!--
Explain consequential choices and assumptions made without user clarification,
including scope deviations and their reasons. Link the relevant code or ADR.
For new domain language, link the CONTEXT.md update. Remove this section if empty.
-->

## Validation

<!--
Report the tested commit SHA, or describe the local working-tree state tested.
Give exact commands and observed results for pnpm run check and pnpm run build.
Label each as passed, failed, or not run; explain failures and skipped checks.
Distinguish local results from CI results and link CI runs when available.

For behavior changes, name the scenarios exercised and their observed outcomes,
including relevant failure paths. Link regression tests, or explain the coverage gap.
For UI changes, include the route, reproduction steps, and screenshots or recordings.
Link the preview when available; identify checks that need configured providers.

Include evidence for affected repo boundaries only:
- Auth/workspaces: denied permissions and cross-workspace access.
- Seed/Live: demo identity parity, including SPA navigation and full-page loads.
- Optional providers: behavior with configuration absent and, when tested, present.
- Infra/bindings: regenerated Wrangler configs and relevant build/deploy checks.
-->

## Risks and remaining work

<!--
State concrete risks, unverified behavior, unmet criteria, and unresolved review
findings. Identify anything blocking merge and link follow-up issues if they exist.
For schema/config changes, state any reset, reseed, or setup steps. This repo has
no production users and requires no backwards-compatibility path.
Write "None known" when there are no remaining risks or gaps to report.
-->
