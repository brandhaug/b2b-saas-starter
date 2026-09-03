import { PlugZapIcon } from 'lucide-react'
import { type McpClientConnection } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { useServerAction } from '@/hooks/use-server-action'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { formatUtc } from '@/lib/format-date'

/** The one server call this panel makes, as a port — a test drives it with a plain function. */
export type RevokeMcpClient = (input: {
  readonly data: { readonly connectionId: string }
}) => Promise<boolean>

const REVOKE_FAILED = 'The connection could not be revoked'

/**
 * The account page's connected MCP clients (ADR 0055): every OAuth consent the
 * user holds, each bound to one workspace, with revoke. The list comes from
 * the route loader, so a successful revoke invalidates the route rather than
 * keeping its own copy.
 */
export function McpClientsPanel({
  connections,
  revoke
}: {
  readonly connections: ReadonlyArray<McpClientConnection>
  readonly revoke: RevokeMcpClient
}) {
  const act = useServerAction(
    (connectionId: string) => revoke({ data: { connectionId } }),
    { failureMessage: REVOKE_FAILED }
  )

  return (
    <section className="grid gap-4" aria-label="Connected MCP clients">
      <header className="flex items-center gap-2">
        <PlugZapIcon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Connected clients</h3>
      </header>

      {act.error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {act.error}
        </p>
      )}

      {connections.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No MCP client is connected to your account. Add this starter's MCP server in
          Claude or another MCP client and sign in when it asks; the connection will
          show up here.
        </p>
      ) : (
        <ul className="grid gap-2">
          {connections.map((connection) => {
            const label = connection.client.name ?? connection.client.clientId
            const busy = act.pending && act.pendingInput === connection.id
            return (
              <li
                key={connection.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-sm border border-border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    {label}
                    {connection.workspace ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · {connection.workspace.name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {' '}
                        · workspace removed
                      </span>
                    )}
                  </p>
                  <p className="text-xs font-mono tabular-nums text-muted-foreground">
                    {connection.scopes.join(' ')} · since{' '}
                    {formatUtc(connection.grantedAt, { dateStyle: 'medium' })}
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={`Revoke ${label}`}
                      />
                    }
                  >
                    Revoke
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogTitle>Revoke {label}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The client loses access to{' '}
                      {connection.workspace?.name ?? 'the workspace'} now, including any
                      token it still holds. It can ask to connect again.
                    </AlertDialogDescription>
                    <div className="flex justify-end gap-2">
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => act.run(connection.id)}>
                        Revoke access
                      </AlertDialogAction>
                    </div>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
