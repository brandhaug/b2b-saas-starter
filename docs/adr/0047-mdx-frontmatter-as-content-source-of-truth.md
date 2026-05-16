# MDX frontmatter as the source of truth for public content

The starter loads docs and blog content by globbing MDX files at build time and parsing each file's YAML frontmatter for title, description, category, order, tags, and date. The previous sidecar TypeScript list of content metadata is removed so that adding a doc or post requires only a new MDX file. Docs are organized into eight Public Knowledge Content categories: getting-started, architecture, starter-modules, capability-interfaces, integrations, adoption-readiness, operations, governance.
