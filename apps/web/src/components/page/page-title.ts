const SITE_TITLE = 'B2B SaaS Starter'

/**
 * The one document-title derivation. Routes keep their per-route `head()`
 * (params live there) but the string itself is built here, so the tab title
 * and the page's visible `h1` can never drift apart. Workspace-scoped pages
 * pass the slug; account-level and public pages call it with the page alone.
 */
export function pageTitle(page: string, workspaceSlug?: string): string {
  return workspaceSlug === undefined
    ? `${page} | ${SITE_TITLE}`
    : `${page} · ${workspaceSlug} | ${SITE_TITLE}`
}
