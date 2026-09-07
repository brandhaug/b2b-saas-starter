import { useState } from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { PageHeader } from '@/components/page/page-header'
import { Panel } from '@/components/page/panel'
import { WorkspaceShell } from '@/components/workspace-shell'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  activateSsoRecoveryServerFn,
  loadSsoRecoveryServerFn,
  updateSsoRecoveryServerFn,
  type SsoRecoveryActivation
} from '@/lib/server/sso-recovery'
import { m } from '@b2b-saas-starter/i18n/messages'
import { type RouteSession } from '@/lib/server/auth'
import { type SsoConnection } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'

export function AccountSsoRepairPage({
  session,
  workspaceSlug,
  exceptionId
}: {
  readonly session: RouteSession
  readonly workspaceSlug: string | undefined
  readonly exceptionId: string | undefined
}) {
  const [activation, setActivation] = useState<SsoRecoveryActivation | null>(null)
  const [connections, setConnections] = useState<ReadonlyArray<SsoConnection>>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function activate() {
    if (exceptionId === undefined || workspaceSlug === undefined) {
      return
    }
    setPending(true)
    setError(null)
    activateSsoRecoveryServerFn({ data: { exceptionId } })
      .then((result) => {
        setActivation(result)
        return loadSsoRecoveryServerFn({ data: { workspaceSlug } })
      })
      .then((loaded) => {
        setConnections(loaded)
        return loaded
      })
      .catch(() => {
        setError(m.sso_repair_failed())
        return null
      })
      .finally(() => {
        setPending(false)
      })
  }

  function disableRequirement(connection: SsoConnection) {
    if (workspaceSlug === undefined) {
      return
    }
    setPending(true)
    setError(null)
    updateSsoRecoveryServerFn({ data: { workspaceSlug, providerId: connection.id } })
      .then((updated) => {
        if (updated !== null) {
          setConnections((current) =>
            current.map((item) => (item.id === updated.id ? updated : item))
          )
        }
        return updated
      })
      .catch(() => {
        setError(m.sso_repair_failed())
        return null
      })
      .finally(() => {
        setPending(false)
      })
  }

  return (
    <WorkspaceShell
      viewer={null}
      systemRole={session.user.role}
      workspaceSlug={workspaceSlug ?? null}
    >
      <PageHeader
        title={m.sso_repair_title()}
        description={m.sso_repair_description()}
      />
      <Panel title={m.sso_repair_start_title()}>
        {error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {activation === null ? (
          <div className="grid max-w-md gap-4">
            <p className="text-sm text-muted-foreground">{m.sso_repair_guidance()}</p>
            <Button
              type="button"
              disabled={
                pending || exceptionId === undefined || workspaceSlug === undefined
              }
              onClick={() => {
                activate()
              }}
            >
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {m.sso_repair_start()}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            <Alert>
              <AlertTitle>{m.sso_repair_title()}</AlertTitle>
              <AlertDescription>{activation.expiresAt}</AlertDescription>
            </Alert>
            {connections.reduce<Array<React.ReactNode>>((items, connection) => {
              if (connection.requireSso) {
                items.push(
                  <div
                    key={connection.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <div className="text-sm">
                      <div className="font-medium">{connection.domain}</div>
                      <div className="text-muted-foreground">{connection.id}</div>
                      <p className="mt-1 text-muted-foreground">
                        {m.sso_repair_disable_impact()}
                      </p>
                    </div>
                    <ConfirmButton
                      label={m.sso_repair_disable_required()}
                      confirmLabel={m.sso_repair_disable_confirm()}
                      busy={pending}
                      onConfirm={() => {
                        disableRequirement(connection)
                      }}
                    />
                  </div>
                )
              }
              return items
            }, [])}
          </div>
        )}
      </Panel>
    </WorkspaceShell>
  )
}
