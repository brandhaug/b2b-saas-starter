import { statusLabel } from '@/lib/value-labels'
import { type WebhookDelivery } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { type WebhookEndpoint } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { Fragment, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { MoreHorizontalIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle
} from '@/components/ui/item'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { WebhookForm, type CreateWebhookEndpoint } from '@/components/webhook-form'
import { ConfirmButton } from '@/components/confirm-button'
import { ActionFeedback } from '@/components/page/action-feedback'
import { CreateAction, Panel } from '@/components/page/panel'
import { Identifier } from '@/components/page/identifier'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { SecretReveal } from '@/components/secret-reveal'
import { enabledVariant, webhookDeliveryStatusVariant } from '@/lib/badge-variants'
import { formatTimestampOr } from '@/lib/format-date'
import { viewerCan, type Viewer } from '@/lib/permissions'
import {
  replayWebhookDeliveryServerFn,
  rotateWebhookSecretServerFn,
  sendTestEventServerFn,
  updateWebhookEndpointServerFn
} from '@/lib/server/webhooks'
import {
  WebhookDeliveriesDrawer,
  type ReplayDelivery,
  type SendTestEvent
} from '@/components/webhook-deliveries-drawer'
import { type ListDeliveryAttempts } from '@/components/webhook-delivery-timeline'
import { useServerAction } from '@/hooks/use-server-action'
import { useKeyedFailure } from '@/hooks/use-keyed-failure'
import { m } from '@b2b-saas-starter/i18n/messages'
import { useWorkspaceView } from '@/lib/workspace-view'
import {
  DeveloperListPagination,
  DeveloperListToolbar
} from '@/components/developer-list-controls'
import { useDeveloperListView } from '@/lib/developer-list'

/**
 * Mutating an endpoint, as a port. Injected rather than imported at the call
 * site so a test drives the panel with real functions of these shapes instead
 * of replacing the module they live in. The defaults are the production server
 * functions, so every caller but a test passes nothing.
 */
export type UpdateWebhookEndpoint = (input: {
  readonly data: {
    readonly workspaceSlug: string
    readonly endpointId: string
    readonly enabled: boolean
  }
}) => Promise<WebhookEndpoint>

export type RotateWebhookSecret = (input: {
  readonly data: {
    readonly workspaceSlug: string
    readonly endpointId: string
  }
}) => Promise<string>

function Deliveries({
  deliveries,
  onOpenDrawer
}: {
  readonly deliveries: ReadonlyArray<WebhookDelivery>
  readonly onOpenDrawer: () => void
}) {
  return (
    <div className="grid gap-2">
      <Button
        variant="ghost"
        size="xs"
        onClick={onOpenDrawer}
        aria-label={m.deliveries_count({ count: deliveries.length })}
      >
        {m.deliveries_count({ count: deliveries.length })}
      </Button>
      {deliveries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{m.empty_no_deliveries()}</p>
      ) : (
        <ul className="grid gap-1">
          {deliveries.slice(0, 3).map((delivery) => (
            <li key={delivery.id} className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant={webhookDeliveryStatusVariant(delivery.status)}>
                {statusLabel(delivery.status)}
              </Badge>
              <span className="font-mono">{delivery.eventType}</span>
              <span className="text-muted-foreground">
                {m.attempt_count({ count: delivery.attempts })}
                {delivery.responseStatus === null
                  ? ''
                  : ` · ${delivery.responseStatus}`}{' '}
                · {formatTimestampOr(delivery.lastAttemptAt, m.never())}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The workspace's webhook endpoints: create (secret shown once), list with
 * recent deliveries, disable, rotate secret. Presentation only — the controls
 * render when the role authorizes them, and every mutation is re-checked
 * server-side by `requireWorkspacePermission` in its server fn.
 */
export function WebhooksPanel({
  workspaceSlug,
  endpoints,
  viewer,
  updateEndpoint = updateWebhookEndpointServerFn,
  rotateSecret = rotateWebhookSecretServerFn,
  createEndpoint,
  replayDelivery = replayWebhookDeliveryServerFn,
  sendTestEvent = sendTestEventServerFn,
  listDeliveryAttempts
}: {
  readonly workspaceSlug: string
  readonly endpoints: ReadonlyArray<
    WebhookEndpoint & {
      readonly deliveries: ReadonlyArray<WebhookDelivery>
    }
  >
  readonly viewer: Viewer
  readonly updateEndpoint?: UpdateWebhookEndpoint
  readonly rotateSecret?: RotateWebhookSecret
  readonly createEndpoint?: CreateWebhookEndpoint
  readonly replayDelivery?: ReplayDelivery
  readonly sendTestEvent?: SendTestEvent
  readonly listDeliveryAttempts?: ListDeliveryAttempts
}) {
  const router = useRouter()
  const { view, update } = useWorkspaceView()
  const [rotatedSecret, setRotatedSecret] = useState<{
    readonly endpointId: string
    readonly secret: string
  } | null>(null)
  // Disabling an endpoint stops its deliveries with no re-enable control in
  // this surface, so it takes a click to arm and a second to commit — the same
  // two-step pattern the settings page's delete uses.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  // The endpoint whose deliveries drawer is open, if any.

  const canCreate = viewerCan(viewer, { webhook: ['create'] })
  const canDisable = viewerCan(viewer, { webhook: ['update'] })
  const canRotate = viewerCan(viewer, { webhook: ['rotateSecret'] })
  const list = useDeveloperListView({
    filters: ['all', 'enabled', 'disabled'],
    sorts: ['url', 'success'],
    defaultFilter: 'all',
    defaultSort: 'url'
  })

  // The loader owns the list, so the hook re-runs it on success rather than
  // mirroring the change into local state.
  const disable = useServerAction(
    (endpointId: string) =>
      updateEndpoint({
        data: { workspaceSlug, endpointId, enabled: false }
      }),
    {
      failureMessage: m.endpoint_disable_failed(),
      onSuccess: () => {
        toast.success(m.endpoint_disabled())
      }
    }
  )

  const rotate = useServerAction(
    (endpointId: string) => rotateSecret({ data: { workspaceSlug, endpointId } }),
    {
      failureMessage: m.secret_rotate_failed(),
      onSuccess: (secret, endpointId) => {
        // No toast: the row's inline ok alert below is where the one-time
        // secret is revealed — the corner copy would announce the rotation
        // without the value.
        setRotatedSecret({ endpointId, secret })
      }
    }
  )

  // A failure renders on the endpoint row that produced it and is cleared by
  // the next mutation — the shared per-row failure hook.
  const { failure: failedRow, runWith: runOnRow } = useKeyedFailure<string>()

  async function disableOnRow(endpointId: string) {
    await runOnRow(endpointId, () => disable.runAsync(endpointId))
  }

  async function rotateOnRow(endpointId: string) {
    setRotatedSecret(null)
    await runOnRow(endpointId, () => rotate.runAsync(endpointId))
  }

  const busyId = disable.pendingInput ?? rotate.pendingInput ?? null
  const drawerEndpoint =
    endpoints.find((endpoint) => endpoint.id === view.record) ?? null
  const filteredEndpoints = (() => {
    const needle = list.query.trim().toLocaleLowerCase()
    return endpoints
      .filter(
        (endpoint) =>
          (list.filter === 'all' ||
            (endpoint.enabled ? 'enabled' : 'disabled') === list.filter) &&
          (needle === '' || endpoint.url.toLocaleLowerCase().includes(needle))
      )
      .toSorted((a, b) =>
        list.sort === 'success'
          ? b.successRate - a.successRate
          : a.url.localeCompare(b.url)
      )
  })()
  const { page, pageCount } = list.pageFor(filteredEndpoints.length)
  const visibleEndpoints = filteredEndpoints.slice(
    (page - 1) * list.pageSize,
    page * list.pageSize
  )

  return (
    // No panel heading: the page header's h1 already says "Webhook
    // endpoints", and the create action belongs on that same title row
    // rather than floating above a second copy of the name.
    <Panel
      actions={
        <CreateAction
          action="create"
          allowed={canCreate}
          title={m.register_endpoint()}
          deniedReason={m.endpoint_register_denied()}
        >
          <WebhookForm
            workspaceSlug={workspaceSlug}
            onCreated={() => void router.invalidate()}
            {...(createEndpoint === undefined ? {} : { createEndpoint })}
          />
        </CreateAction>
      }
    >
      {endpoints.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{m.empty_no_endpoints()}</EmptyTitle>
            <EmptyDescription>{m.create_endpoint_description()}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <DeveloperListToolbar
            query={list.query}
            filter={list.filter}
            sort={list.sort}
            searchLabel={m.developer_list_search_endpoints()}
            filters={[
              { value: 'all', label: m.developer_list_all_statuses() },
              { value: 'enabled', label: m.developer_list_enabled() },
              { value: 'disabled', label: m.developer_list_disabled() }
            ]}
            sorts={[
              { value: 'url', label: m.developer_list_url() },
              { value: 'success', label: m.developer_list_success_rate() }
            ]}
            onChange={list.updateView}
          />
          {visibleEndpoints.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              {m.developer_list_no_matching_endpoints()}
            </p>
          ) : null}
          <ItemGroup className="gap-0">
            {visibleEndpoints.map((endpoint, index) => (
              <Fragment key={endpoint.id}>
                <Item className="flex-col items-stretch border-0 px-0 py-4">
                  <ItemContent>
                    <ItemTitle className="flex-wrap">
                      <Identifier>{endpoint.url}</Identifier>
                      <Badge variant={enabledVariant(endpoint.enabled)}>
                        {endpoint.enabled ? m.common_enabled() : m.common_disabled()}
                      </Badge>
                    </ItemTitle>
                    <ItemDescription>
                      {m.success_rate({ rate: endpoint.successRate })}
                    </ItemDescription>
                    <div className="flex flex-wrap gap-1">
                      {endpoint.events.map((event) => (
                        <Badge key={event} variant="outline">
                          {event}
                        </Badge>
                      ))}
                    </div>
                  </ItemContent>

                  <Deliveries
                    deliveries={endpoint.deliveries}
                    onOpenDrawer={() => {
                      update({ record: endpoint.id })
                    }}
                  />

                  {(canDisable || canRotate) && endpoint.enabled ? (
                    <ItemActions className="flex-wrap">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={m.developer_list_more_actions()}
                            />
                          }
                        >
                          <MoreHorizontalIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {canDisable ? (
                            <DropdownMenuItem
                              onClick={() => setConfirmingId(endpoint.id)}
                            >
                              {m.disable_action()}
                            </DropdownMenuItem>
                          ) : null}
                          {canRotate ? (
                            <DropdownMenuItem
                              onClick={() => void rotateOnRow(endpoint.id)}
                            >
                              {m.rotate_secret()}
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      {canDisable && confirmingId === endpoint.id ? (
                        <ConfirmButton
                          label={m.disable_action()}
                          confirmLabel={m.confirm_disable()}
                          armed={confirmingId === endpoint.id}
                          busy={busyId === endpoint.id}
                          onArm={() => setConfirmingId(endpoint.id)}
                          onCancel={() => setConfirmingId(null)}
                          onConfirm={() => void disableOnRow(endpoint.id)}
                        />
                      ) : null}
                    </ItemActions>
                  ) : null}

                  {failedRow?.key === endpoint.id ? (
                    <ActionFeedback error={failedRow.message} />
                  ) : null}

                  {rotatedSecret?.endpointId === endpoint.id ? (
                    <>
                      <Separator />
                      {/* `ok`, not the neutral default: this is the one moment
                        the signing secret is visible, the same treatment the
                        API token form's reveal gets. */}
                      <Alert variant="ok">
                        <AlertTitle>{m.secret_rotated_copy_now()}</AlertTitle>
                        <AlertDescription>
                          <SecretReveal
                            secret={rotatedSecret.secret}
                            label={m.webhook_secret()}
                            className="flex items-center gap-2"
                          />
                          <p className="mt-2 text-xs text-muted-foreground">
                            {m.webhook_secret_rotation_description()}
                          </p>
                        </AlertDescription>
                      </Alert>
                    </>
                  ) : null}
                </Item>
                {index < visibleEndpoints.length - 1 ? <Separator /> : null}
              </Fragment>
            ))}
          </ItemGroup>
          <DeveloperListPagination
            page={page}
            pageCount={pageCount}
            onChange={list.updateView}
          />
        </>
      )}

      {drawerEndpoint === null ? null : (
        <WebhookDeliveriesDrawer
          workspaceSlug={workspaceSlug}
          endpoint={drawerEndpoint}
          open
          onOpenChange={(nextOpen) => {
            if (nextOpen) {
              return
            }
            update({ record: undefined }, true)
          }}
          viewer={viewer}
          replayDelivery={replayDelivery}
          sendTestEvent={sendTestEvent}
          {...(listDeliveryAttempts === undefined ? {} : { listDeliveryAttempts })}
        />
      )}
    </Panel>
  )
}
