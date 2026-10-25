# Checked-in LLM documentation

`apps/web/public/llms.txt`, `llms-full.txt` and `agent-docs/` are checked-in,
build-generated views of `apps/web/content/docs/**/*.mdx`. That public collection
is the publication boundary; internal guides and agent instructions are not inputs.

`llms.txt` links common tasks to explicit Markdown URLs. `llms-full.txt` contains
every article. `/agent-docs/index.json` records path-based stable IDs, titles,
descriptions, canonical `/en/docs/` URLs, Markdown URLs, repository source paths
and SHA-256 digests of exact UTF-8 Markdown bytes. URLs are origin-relative so the
same assets work on forks and preview deployments. Renaming an article changes its
ID. Article bodies remain English, including when linked from Norwegian navigation.

The dedicated Node build module parses MDX without evaluating it. Markdown code,
tables and prose are serialized as Markdown; documentation links target
the corresponding Markdown export. `ArchitectureSchematic` has an explicit plain
representation. Unsupported components, attributes, expressions, module code and
relative destinations fail with source diagnostics rather than losing content.
New MDX components need an export representation before publication.

Run `pnpm -C apps/web docs:generate` after editing public docs. Vite builds also
generate the assets before copying public files, including deployment and E2E
builds. `pnpm run check:agent-docs` checks missing, changed and obsolete outputs
without writing and exercises the generator against disposable collections. Root
`check` and the CI quality job run it before a build can repair drift.
Generated Markdown is excluded from formatting to preserve content digests.

Repeat the served-asset check with
`CI=1 E2E_PORT=3197 pnpm -C apps/web exec playwright test e2e/agent-exports.spec.ts --project=chromium --no-deps`.
It checks representative article and index responses, linked Markdown assets and
English content under Norwegian language preference. The JSON Playwright report
is written to `apps/web/playwright-report/results.json`.
