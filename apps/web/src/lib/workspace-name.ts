/**
 * The workspace-name field validator shared by the create form and the
 * settings rename form: required, and within the 80 characters the server's
 * create/rename schemas enforce. Client-safe — no server imports — so both
 * forms can ship it to the browser.
 */
import { m } from '@b2b-saas-starter/i18n/messages'

export function validateWorkspaceName(value: string): string | undefined {
  if (value.trim().length === 0) {
    return m.workspace_name_required()
  }
  if (value.length > 80) {
    return m.workspace_name_maximum()
  }
  return
}
