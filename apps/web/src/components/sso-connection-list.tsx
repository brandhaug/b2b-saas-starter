import { type SsoConnection } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { useState } from 'react'

import { ConfirmButton } from '@/components/confirm-button'
import { ActionFeedback } from '@/components/page/action-feedback'
import { Identifier } from '@/components/page/identifier'
import { ListSection } from '@/components/page/panel'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Label } from '@/components/ui/label'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle
} from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { type useServerAction } from '@/hooks/use-server-action'
import {
  type SsoTestResult,
  type DomainVerificationRecord,
  type UpdateSsoConnectionInput
} from '@/lib/server/workspace-sso'
import { m } from '@b2b-saas-starter/i18n/messages'
import { authClient } from '@/lib/auth-client'

/**
 * The list half of the SSO panel: the connections and their per-row verdicts.
 * Gated per statement — `canUpdate` shows the test/enable/require-SSO
 * controls, `canRemove` the removal — and every control's action is
 * re-checked on the server. Presentation only.
 */
export function ConnectionList({
  workspaceSlug,
  connections,
  canUpdate,
  canRemove,
  testResult,
  verificationRecord,
  update,
  remove,
  test,
  requestDomainVerification,
  verifyDomain
}: {
  readonly workspaceSlug: string
  readonly connections: ReadonlyArray<SsoConnection>
  readonly canUpdate: boolean
  readonly canRemove: boolean
  readonly testResult: ({ readonly providerId: string } & SsoTestResult) | null
  readonly verificationRecord:
    | ({ readonly providerId: string } & DomainVerificationRecord)
    | null
  readonly update: ReturnType<
    typeof useServerAction<UpdateSsoConnectionInput, SsoConnection | null>
  >
  readonly remove: ReturnType<typeof useServerAction<string, boolean>>
  readonly test: ReturnType<typeof useServerAction<string, SsoTestResult>>
  readonly requestDomainVerification: ReturnType<
    typeof useServerAction<string, DomainVerificationRecord>
  >
  readonly verifyDomain: ReturnType<typeof useServerAction<string, boolean>>
}) {
  const requiredConnection =
    connections.find((connection) => connection.requireSso) ?? null
  return (
    <ListSection
      title={m.sso_connections()}
      footer={
        <>
          {/* Stacked, not merged: each mutation's failure renders in its own
              alert, the same idiom the sessions panel uses. */}
          <ActionFeedback error={update.error} />
          <ActionFeedback error={remove.error} />
          <ActionFeedback error={test.error} />
          <ActionFeedback error={requestDomainVerification.error} />
          <ActionFeedback error={verifyDomain.error} />
        </>
      }
    >
      {connections.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{m.empty_no_sso()}</EmptyTitle>
            <EmptyDescription>{m.sso_empty_description()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup>
          {connections.map((connection) => (
            <ConnectionRow
              key={connection.id}
              workspaceSlug={workspaceSlug}
              connection={connection}
              requiredConnection={requiredConnection}
              canUpdate={canUpdate}
              canRemove={canRemove}
              testResult={testResult?.providerId === connection.id ? testResult : null}
              verificationRecord={
                verificationRecord?.providerId === connection.id
                  ? verificationRecord
                  : null
              }
              update={update}
              remove={remove}
              test={test}
              requestDomainVerification={requestDomainVerification}
              verifyDomain={verifyDomain}
            />
          ))}
        </ItemGroup>
      )}
    </ListSection>
  )
}

function ConnectionRow({
  workspaceSlug,
  connection,
  requiredConnection,
  canUpdate,
  canRemove,
  testResult,
  verificationRecord,
  update,
  remove,
  test,
  requestDomainVerification,
  verifyDomain
}: {
  readonly workspaceSlug: string
  readonly connection: SsoConnection
  readonly requiredConnection: SsoConnection | null
  readonly canUpdate: boolean
  readonly canRemove: boolean
  readonly testResult: ({ readonly providerId: string } & SsoTestResult) | null
  readonly verificationRecord:
    | ({ readonly providerId: string } & DomainVerificationRecord)
    | null
  readonly update: ReturnType<
    typeof useServerAction<UpdateSsoConnectionInput, SsoConnection | null>
  >
  readonly remove: ReturnType<typeof useServerAction<string, boolean>>
  readonly test: ReturnType<typeof useServerAction<string, SsoTestResult>>
  readonly requestDomainVerification: ReturnType<
    typeof useServerAction<string, DomainVerificationRecord>
  >
  readonly verifyDomain: ReturnType<typeof useServerAction<string, boolean>>
}) {
  const [dialogAction, setDialogAction] = useState<'require' | 'replace' | null>(null)
  const updating = update.pendingInput?.providerId === connection.id
  const canReplaceRequiredConnection =
    canUpdate &&
    requiredConnection !== null &&
    requiredConnection.id !== connection.id &&
    connection.domainVerified &&
    connection.lastLoginTestedAt !== null
  return (
    <Item variant="outline" size="sm">
      <ItemContent>
        <ItemTitle>
          <Identifier>{connection.domain}</Identifier>
        </ItemTitle>
        <ItemDescription>
          {/* The provider id is what owners paste into their IdP config, so it
              renders as a copyable identifier, not prose. */}
          <Identifier>{connection.id}</Identifier>
          {' · '}
          {connection.protocol.toUpperCase()} · {connection.issuer}
          {connection.clientIdLastFour === null
            ? null
            : ` · ${m.sso_connection_client({ id: connection.clientIdLastFour })}`}
          {' · '}
          {m.sso_connection_joins()} {connection.defaultWorkspaceRole}
        </ItemDescription>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={connection.domainVerified ? 'ok' : 'warn'}>
            {connection.domainVerified
              ? m.sso_domain_verified()
              : m.sso_domain_unverified()}
          </Badge>
          {verificationRecord === null ? null : (
            <Alert>
              <AlertTitle>{m.sso_domain_add_txt()}</AlertTitle>
              <AlertDescription className="font-mono text-xs">
                {verificationRecord.recordName} IN TXT {verificationRecord.recordValue}
              </AlertDescription>
            </Alert>
          )}
        </div>
        {testResult === null ? null : (
          <Alert variant={testResult.outcome === 'passed' ? 'default' : 'destructive'}>
            <AlertTitle>
              {testResult.outcome === 'passed'
                ? m.sso_connection_test_passed_diagnostic()
                : m.sso_connection_test_failed_diagnostic()}
            </AlertTitle>
            {testResult.outcome === 'failed' ? (
              <AlertDescription>{testResult.message}</AlertDescription>
            ) : null}
          </Alert>
        )}
      </ItemContent>
      <ItemActions className="flex-wrap">
        <Badge variant={connection.enabled ? 'ok' : 'neutral'}>
          {connection.enabled
            ? m.sso_connection_routing()
            : m.sso_connection_disabled()}
        </Badge>
        {canUpdate ? (
          <>
            <Button
              variant="ghost"
              disabled={requestDomainVerification.pending || verifyDomain.pending}
              onClick={() => requestDomainVerification.run(connection.id)}
            >
              {m.sso_domain_request_txt()}
            </Button>
            <Button
              variant="ghost"
              disabled={verifyDomain.pending}
              onClick={() => verifyDomain.run(connection.id)}
            >
              {m.sso_domain_verify()}
            </Button>
            <Button
              variant="ghost"
              disabled={test.pendingInput === connection.id}
              onClick={() => test.run(connection.id)}
            >
              {test.pendingInput === connection.id ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              {m.sso_connection_test()}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                void authClient.signIn.sso({
                  providerId: connection.id,
                  callbackURL: `/workspaces/${workspaceSlug}/settings`
                })
              }
            >
              {m.sso_connection_login_test()}
            </Button>
            <Button
              variant="ghost"
              disabled={
                updating ||
                (!connection.enabled &&
                  (!connection.domainVerified || connection.lastLoginTestedAt === null))
              }
              title={
                !connection.enabled &&
                (!connection.domainVerified || connection.lastLoginTestedAt === null)
                  ? m.sso_activation_prerequisites()
                  : undefined
              }
              onClick={() =>
                update.run({
                  workspaceSlug,
                  providerId: connection.id,
                  enabled: !connection.enabled
                })
              }
            >
              {connection.enabled
                ? m.sso_connection_disable()
                : m.sso_connection_enable()}
            </Button>
            {canReplaceRequiredConnection ? (
              <Button
                variant="ghost"
                disabled={updating}
                onClick={() => setDialogAction('replace')}
              >
                {m.sso_connection_replace()}
              </Button>
            ) : null}
          </>
        ) : null}
        {canRemove ? (
          <ConfirmButton
            label={m.action_remove()}
            confirmLabel={m.sso_connection_remove()}
            busy={remove.pendingInput === connection.id}
            onConfirm={() => remove.run(connection.id)}
            target={connection.domain}
          />
        ) : null}
      </ItemActions>
      {canUpdate ? (
        <ItemActions className="flex items-center gap-2">
          <Switch
            id={`require-sso-${connection.id}`}
            checked={connection.requireSso}
            disabled={updating}
            onCheckedChange={(checked) =>
              checked
                ? setDialogAction('require')
                : update.run({
                    workspaceSlug,
                    providerId: connection.id,
                    requireSso: false
                  })
            }
          />
          <Label
            htmlFor={`require-sso-${connection.id}`}
            className="text-xs font-normal text-muted-foreground"
          >
            {m.sso_connection_require()}
          </Label>
          <Label
            htmlFor={`auto-join-${connection.id}`}
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <Checkbox
              id={`auto-join-${connection.id}`}
              checked={connection.autoJoin}
              disabled={!connection.domainVerified || updating}
              onCheckedChange={(checked) =>
                update.run({
                  workspaceSlug,
                  providerId: connection.id,
                  autoJoin: checked
                })
              }
            />
            <span>{m.sso_autojoin_members()}</span>
          </Label>
          <AlertDialog
            open={dialogAction !== null}
            onOpenChange={(open) => {
              if (!open) {
                setDialogAction(null)
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogTitle>
                {dialogAction === 'replace'
                  ? m.sso_connection_replacement_title()
                  : m.sso_connection_enforcement_title()}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {dialogAction === 'replace'
                  ? m.sso_connection_replacement_description({
                      domain: connection.domain,
                      currentDomain: requiredConnection?.domain ?? ''
                    })
                  : m.sso_connection_enforcement_description()}
              </AlertDialogDescription>
              <div className="flex justify-end gap-2">
                <AlertDialogCancel>
                  {m.sso_connection_enforcement_cancel()}
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const action = dialogAction
                    setDialogAction(null)
                    if (action === 'replace' && requiredConnection !== null) {
                      update.run({
                        workspaceSlug,
                        providerId: connection.id,
                        enabled: true,
                        replaceProviderId: requiredConnection.id,
                        confirmEnforcement: true
                      })
                    } else {
                      update.run({
                        workspaceSlug,
                        providerId: connection.id,
                        requireSso: true,
                        // This explicit acknowledgement is checked again by the
                        // server effect; it is never treated as proof by itself.
                        confirmEnforcement: true
                      })
                    }
                  }}
                >
                  {dialogAction === 'replace'
                    ? m.sso_connection_replacement_confirm()
                    : m.sso_connection_enforcement_confirm()}
                </AlertDialogAction>
              </div>
            </AlertDialogContent>
          </AlertDialog>
        </ItemActions>
      ) : null}
    </Item>
  )
}
