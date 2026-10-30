# Public documentation search

Open **Search documentation** in the docs navigation, or find it in the public
header's command palette. `/docs/search` and `/no/docs/search` search the same
English article content. Queries remain in the URL's `q` parameter so refresh,
back, and shared links retain the search. Queries are limited to 200 characters.

## Index contract

`apps/web/scripts/docs-search-index.ts` is a Vite build plugin. It reads only
regular MDX files under `apps/web/content/docs`, sorted by path. It parses MDX
without evaluating imports or expressions. Prose and inline code are searchable;
fenced code, expressions, imports, JSX attributes, and frontmatter are excluded
from body text. Titles and descriptions come from validated YAML frontmatter.

Each record contains:

- `id`: the existing `category/slug` pair, independent of locale or title.
- `route`: the locale-neutral `/docs/category/slug` route.
- `category`, `slug`, `title`, and a description excerpt capped at 240 characters.
- `text`: normalized public prose used for matching and result excerpts.
- `source`: the MDX file's GitHub source link on `master`.
- `digest`: SHA-256 of the source with CRLF normalized to LF, prefixed `sha256:`.

Source links follow the repository branch; digests identify the content used by
the build. Paths must use a known category and a lowercase kebab-case slug.
The build fails above a 512 KB serialized index budget. The virtual module is
generated during each build, so there is no checked-in index to refresh.

Search matches all whitespace-separated terms, ignoring case. Title matches rank
above body matches, with stable IDs breaking ties. Results show a bounded excerpt
near the first matching term, an article link, and a source link. Article links
preserve the public locale and do not preload compiled MDX on result focus.

The index has no internal docs or workspace data inputs. MDX/YAML parsers and
frontmatter validation run only in Vite, never in the browser. The search route
includes its index in SSR flags. Foldkit compiles article HTML on the server;
the browser receives no React MDX components or article implementation chunks.

## Verification

After installing dependencies, migrating and seeding local D1:

```sh
CI=1 E2E_PORT=43871 E2E_STARTUP_TIMEOUT=360000 pnpm -C apps/web exec playwright test e2e/docs-search.spec.ts --project=chromium --no-deps
pnpm -C apps/web build
pnpm run check
E2E_PORT=43871 pnpm run validate
```

Choose another unused port if another worktree owns it. The focused Playwright
run uses the compiled preview. It checks empty and no-result states, a body-text
match, source and locale routes, Tab/Enter navigation, mobile refresh, and the
requested scripts. It also verifies Quickstart's digest in the SSR search flags
and excludes article-body markup from downloaded scripts. Attachments include desktop
and mobile screenshots and the script request list; the JSON report is
`apps/web/playwright-report/results.json`.

### Historical React baseline

On 2026-10-25, the implementation integrated with `master` at `731fc604`
passed `CI=1 E2E_PORT=43871 E2E_STARTUP_TIMEOUT=360000 pnpm run validate`.
The full browser suite reported 65 passed and 11 skipped, including both search
tests. Type checks, lint, formatting, dead-code checks, catalog checks, repository
tests, build, client bundle guard, and generated Wrangler drift checks passed.
The search tests observed no compiled article requests before result navigation
and matched Quickstart's SHA-256 digest in the search chunk.

Earlier runs hit authentication test timeouts during host contention, and one
validation run exceeded its ten-minute command deadline. The completed run used
a twenty-minute deadline without changing test timeouts or application behavior.
Local command logs are retained under the session's temporary directory as
`docs-search-integrated-validation.log`; Playwright regenerates the screenshots and
request-list attachments on each run.

Markdown and llms exports are owned separately. This index's category/slug IDs
and canonical routes are available for later integration; there is no public
search/read API or workspace MCP registration.
