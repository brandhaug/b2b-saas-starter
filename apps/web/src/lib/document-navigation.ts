/** Full-document navigation for authentication cookie and session handoffs. */
export function navigateDocument(href: string): void {
  window.location.assign(href)
}
