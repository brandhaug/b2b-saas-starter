# Issue tracker

Use GitHub as the source for issue context. Infer the repository from the current checkout's `origin` remote, then use `gh` against that repository. Do not ask for an owner/repository pair when the checkout already identifies it.

## Read an issue

Before writing a spec or reviewing a change, fetch the complete issue, including comments:

```bash
gh issue view <number> --comments
```

`gh` infers the repository from the checkout's `origin`. Add `--repo <owner/repo>` only when intentionally reading an issue from another repository.

Read the title, body, every comment, linked issues, and any dependency language. Follow referenced issues far enough to establish ordering and ownership. Treat a linked issue as a dependency only when the issue or its comments say so. Record the issue number and URL in the working notes.

Labels are evidence, not decoration. Use labels that already exist in the repository; inspect them with `gh label list` before applying one. If no existing label fits, leave labels unchanged rather than inventing one.

## Turn an issue into work

`$to-tickets` turns an agreed issue into approved vertical slices. Keep the parent issue as the source of scope. Create child issues only for independently reviewable slices, and link them with GitHub's native blocker relation when GitHub supports it. Preserve the parent's acceptance-criteria IDs across every slice. A slice may narrow an AC, but it must not silently rename or drop it. The parent remains unchanged unless the user separately authorizes an edit to it.

When an issue has multiple proposed versions, the latest version explicitly agreed in the issue or comments is the current spec. An explicitly authorized update can replace stale wording in that issue. Keep the same AC IDs while updating their text, and note the superseded wording in the issue history or working notes. Do not rewrite an issue merely because a newer interpretation seems nicer.

Each slice needs an outcome, the AC IDs it covers, its dependencies, and a checkable completion condition. Prefer one vertical path through the real capability, contract, adapter, and caller over layer-by-layer tickets. If a dependency cannot be represented with a native blocker link, name the dependency in the child body and retain the parent link. The repository permits bounded atomic refactors and integration branches; its no-compatibility-shim posture overrides generic expand-contract recipes.

## Give review a stable spec

`$code-review` uses the originating issue as the spec axis. Before review, identify issue references in commit messages and fetch those issues with the command above. Compare the diff to the current agreed wording and AC IDs. If no issue or spec source can be identified, ask the user where the spec is. Continue without a Spec axis only after the user confirms that no spec exists; never silently invent requirements or silently skip the axis.

The feature template at [`.github/ISSUE_TEMPLATE/feature.md`](../../.github/ISSUE_TEMPLATE/feature.md) is the minimum shape for a new spec. `$implement` should link the issue, preserve its AC IDs in code or tests where useful, and use the repository intent nodes before choosing an Effect pattern. For Effect examples, read [effect-examples.md](./effect-examples.md).
