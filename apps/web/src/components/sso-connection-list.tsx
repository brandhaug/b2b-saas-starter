import { type SsoConnection } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'

import { ConfirmButton } from '@/components/confirm-button'
import { ActionFeedback } from '@/components/page/action-feedback'
import { Identifier } from '@/components/page/identifier'
import { ListSection } from '@/components/page/panel'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  type UpdateSsoConnectionInput
} from '@/lib/server/workspace-sso'

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
  update,
  remove,
  test
}: {
  readonly workspaceSlug: string
  readonly connections: ReadonlyArray<SsoConnection>
  readonly canUpdate: boolean
  readonly canRemove: boolean
  readonly testResult: ({ readonly providerId: string } & SsoTestResult) | null
  readonly update: ReturnType<
    typeof useServerAction<UpdateSsoConnectionInput, SsoConnection | null>
  >
  readonly remove: ReturnType<typeof useServerAction<string, boolean>>
  readonly test: ReturnType<typeof useServerAction<string, SsoTestResult>>
}) {
  return (
    <ListSection
      title="Connections"
      footer={
        <>
          {/* Stacked, not merged: each mutation's failure renders in its own
              alert, the same idiom the sessions panel uses. */}
          <ActionFeedback error={update.error} />
          <ActionFeedback error={remove.error} />
          <ActionFeedback error={test.error} />
        </>
      }
    >
      {connections.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No SSO connections yet</EmptyTitle>
            <EmptyDescription>
              Add one above; sign-ins for its domain route to the IdP once an owner
              enables it.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup>
          {connections.map((connection) => (
            <ConnectionRow
              key={connection.id}
              workspaceSlug={workspaceSlug}
              connection={connection}
              canUpdate={canUpdate}
              canRemove={canRemove}
              testResult={testResult?.providerId === connection.id ? testResult : null}
              update={update}
              remove={remove}
              test={test}
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
  canUpdate,
  canRemove,
  testResult,
  update,
  remove,
  test
}: {
  readonly workspaceSlug: string
  readonly connection: SsoConnection
  readonly canUpdate: boolean
  readonly canRemove: boolean
  readonly testResult: ({ readonly providerId: string } & SsoTestResult) | null
  readonly update: ReturnType<
    typeof useServerAction<UpdateSsoConnectionInput, SsoConnection | null>
  >
  readonly remove: ReturnType<typeof useServerAction<string, boolean>>
  readonly test: ReturnType<typeof useServerAction<string, SsoTestResult>>
}) {
  const updating = update.pendingInput?.providerId === connection.id
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
            : ` · client …${connection.clientIdLastFour}`}
          {' · joins as '}
          {connection.defaultWorkspaceRole}
        </ItemDescription>
        {testResult === null ? null : (
          <Alert variant={testResult.outcome === 'passed' ? 'default' : 'destructive'}>
            <AlertTitle>
              {testResult.outcome === 'passed'
                ? 'Connection test passed.'
                : 'Connection test failed.'}
            </AlertTitle>
            {testResult.outcome === 'failed' ? (
              <AlertDescription>{testResult.message}</AlertDescription>
            ) : null}
          </Alert>
        )}
      </ItemContent>
      <ItemActions className="flex-wrap">
        <Badge variant={connection.enabled ? 'ok' : 'neutral'}>
          {connection.enabled ? 'routing' : 'disabled'}
        </Badge>
        {canUpdate ? (
          <>
            <Button
              variant="ghost"
              disabled={test.pendingInput === connection.id}
              onClick={() => test.run(connection.id)}
            >
              {test.pendingInput === connection.id ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              Test
            </Button>
            <Button
              variant="ghost"
              disabled={updating}
              onClick={() =>
                update.run({
                  workspaceSlug,
                  providerId: connection.id,
                  enabled: !connection.enabled
                })
              }
            >
              {connection.enabled ? 'Disable' : 'Enable'}
            </Button>
          </>
        ) : null}
        {canRemove ? (
          <ConfirmButton
            label="Remove"
            confirmLabel="Remove connection"
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
              update.run({
                workspaceSlug,
                providerId: connection.id,
                requireSso: checked
              })
            }
          />
          <Label
            htmlFor={`require-sso-${connection.id}`}
            className="text-xs font-normal text-muted-foreground"
          >
            Require SSO for this domain
          </Label>
        </ItemActions>
      ) : null}
    </Item>
  )
}
