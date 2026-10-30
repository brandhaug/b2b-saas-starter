import { useEffect, useRef } from 'react'
import { useForm } from '@tanstack/react-form'
import { type ResourceEntitlement } from '@b2b-saas-starter/billing/plan-catalog'
import { m } from '@b2b-saas-starter/i18n/messages'
import { useServerAction } from '@/hooks/use-server-action'
import { Panel } from '@/components/page/panel'
import { ActionFeedback } from '@/components/page/action-feedback'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { type SelectBillingResources } from './workspace-billing'

const EMPTY_RESOURCE_IDS: ReadonlyArray<string> = []
const RESOURCE_ID_SEPARATOR = ','

export function DowngradeResourceSelector({
  workspaceSlug,
  resourceSelection,
  apiTokens,
  webhookEndpoints,
  selectBillingResources,
  resourceEntitlements
}: {
  readonly workspaceSlug: string
  readonly resourceSelection: {
    readonly apiTokenIds: ReadonlyArray<string>
    readonly webhookEndpointIds: ReadonlyArray<string>
  } | null
  readonly apiTokens: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly webhookEndpoints: ReadonlyArray<{
    readonly id: string
    readonly url: string
  }>
  readonly selectBillingResources: SelectBillingResources
  readonly resourceEntitlements: {
    readonly apiTokens: ResourceEntitlement
    readonly webhookEndpoints: ResourceEntitlement
  }
}) {
  // Compare server selections by content: polling creates new array identities
  // even when the saved selection is unchanged and must preserve a dirty draft.
  const serverTokenKey = selectionKey(resourceSelection?.apiTokenIds, apiTokens, 2)
  const serverWebhookKey = selectionKey(
    resourceSelection?.webhookEndpointIds,
    webhookEndpoints,
    1
  )
  const selection = useServerAction(
    (input: Parameters<SelectBillingResources>[0]) => selectBillingResources(input),
    { failureMessage: m.billing_save_selection_failed(), invalidate: true }
  )
  const tokenInventory = apiTokens.map(({ id }) => id).join(RESOURCE_ID_SEPARATOR)
  const webhookInventory = webhookEndpoints
    .map(({ id }) => id)
    .join(RESOURCE_ID_SEPARATOR)
  const savedSelectionKey = JSON.stringify(resourceSelection)
  const previousSavedSelection = useRef(savedSelectionKey)
  const form = useForm({
    defaultValues: {
      tokenIds: selectionFromKey(serverTokenKey),
      webhookIds: selectionFromKey(serverWebhookKey)
    },
    onSubmit: async ({ value }) => {
      await selection.runAsync({
        data: {
          workspaceSlug,
          apiTokenIds: reconcileSelection(
            value.tokenIds,
            selectionFromKey(tokenInventory),
            2
          ),
          webhookEndpointIds: reconcileSelection(
            value.webhookIds,
            selectionFromKey(webhookInventory),
            1
          )
        }
      })
    }
  })
  useEffect(() => {
    if (previousSavedSelection.current !== savedSelectionKey) {
      previousSavedSelection.current = savedSelectionKey
      form.reset({
        tokenIds: selectionFromKey(serverTokenKey),
        webhookIds: selectionFromKey(serverWebhookKey)
      })
      return
    }
    // Inventory refreshes prune missing IDs without overwriting valid dirty values.
    form.setFieldValue('tokenIds', (ids) =>
      reconcileSelection(ids, selectionFromKey(tokenInventory), 2)
    )
    form.setFieldValue('webhookIds', (ids) =>
      reconcileSelection(ids, selectionFromKey(webhookInventory), 1)
    )
  }, [
    form,
    savedSelectionKey,
    serverTokenKey,
    serverWebhookKey,
    tokenInventory,
    webhookInventory
  ])
  const overLimit = [
    resourceEntitlements.apiTokens,
    resourceEntitlements.webhookEndpoints
  ].some(({ used, limit }) => limit !== null && used > limit)
  if (!overLimit) {
    return null
  }
  return (
    <Panel title={m.billing_resource_selection_title()}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <p className="mb-4 text-sm text-muted-foreground">
          {m.billing_resource_selection_description()}
        </p>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(pending) => (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <form.Field name="tokenIds">
                  {(field) => (
                    <ResourceChoices
                      label={m.nav_api_tokens()}
                      items={apiTokens}
                      selected={field.state.value}
                      disabled={pending}
                      onToggle={(id) => toggleResource(id, 2, field.handleChange)}
                    />
                  )}
                </form.Field>
                <form.Field name="webhookIds">
                  {(field) => (
                    <ResourceChoices
                      label={m.nav_webhook_endpoints()}
                      items={webhookEndpoints}
                      selected={field.state.value}
                      disabled={pending}
                      onToggle={(id) => toggleResource(id, 1, field.handleChange)}
                    />
                  )}
                </form.Field>
              </div>
              <Button type="submit" className="mt-4" disabled={pending}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                {m.billing_save_selection()}
              </Button>
            </>
          )}
        </form.Subscribe>
        <ActionFeedback error={selection.error} />
      </form>
    </Panel>
  )
}

function toggleResource(
  id: string,
  limit: number,
  set: (update: (selected: ReadonlyArray<string>) => ReadonlyArray<string>) => void
): void {
  set((selected) => {
    if (selected.includes(id)) {
      return selected.filter((item) => item !== id)
    }
    return selected.length < limit ? [...selected, id] : selected
  })
}

function reconcileSelection(
  selected: ReadonlyArray<string>,
  available: ReadonlyArray<string>,
  limit: number
): ReadonlyArray<string> {
  const availableIds = new Set(available)
  return selected.filter((id) => availableIds.has(id)).slice(0, limit)
}

/** Resource IDs contain no comma, so their normalized selection round-trips. */
function selectionKey(
  selected: ReadonlyArray<string> | undefined,
  available: ReadonlyArray<{ readonly id: string }>,
  limit: number
): string {
  return reconcileSelection(
    selected ?? EMPTY_RESOURCE_IDS,
    available.map(({ id }) => id),
    limit
  ).join(RESOURCE_ID_SEPARATOR)
}

function selectionFromKey(key: string): ReadonlyArray<string> {
  return key === '' ? EMPTY_RESOURCE_IDS : key.split(RESOURCE_ID_SEPARATOR)
}

function ResourceChoices({
  label,
  items,
  selected,
  disabled,
  onToggle
}: {
  readonly label: string
  readonly items: ReadonlyArray<{
    readonly id: string
    readonly name?: string
    readonly url?: string
  }>
  readonly selected: ReadonlyArray<string>
  readonly disabled: boolean
  readonly onToggle: (id: string) => void
}) {
  const selectedIds = new Set(selected)
  return (
    <fieldset>
      <legend className="text-sm font-medium">{label}</legend>
      <div className="mt-2 grid gap-2">
        {items.map((item) => (
          <Label key={item.id} htmlFor={`billing-resource-${item.id}`}>
            <Checkbox
              id={`billing-resource-${item.id}`}
              checked={selectedIds.has(item.id)}
              disabled={disabled}
              onCheckedChange={() => onToggle(item.id)}
            />
            <code>{item.name ?? item.url ?? item.id}</code>
          </Label>
        ))}
      </div>
    </fieldset>
  )
}
