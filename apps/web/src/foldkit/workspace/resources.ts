import { Effect, Option, Result, Schema, Stream } from 'effect'
import { ManagedResource, Render, Subscription } from 'foldkit'
import { observe } from './conversation-observer'
import { Message, type Model } from './model'

const Dialog = ManagedResource.tag<{
  dialog: HTMLDialogElement
  previous: Element | null
  auditEventId: string | null
}>()('Workspace.Dialog')
export const managedResources = ManagedResource.make<Model, Message>()((entry) => ({
  dialog: entry(Schema.Option(Schema.String), {
    resource: Dialog,
    modelToMaybeRequirements: (model) =>
      model.ready && model.dialog !== null ? Option.some(model.dialog) : Option.none(),
    acquire: () =>
      Effect.gen(function* () {
        yield* Render.afterCommit
        const dialog = document.getElementById('workspace-dialog')
        if (!(dialog instanceof HTMLDialogElement)) {
          return yield* Effect.fail('DialogUnavailable' as const)
        }
        return yield* Effect.try({
          try: () => {
            const previous = document.activeElement
            dialog.showModal()
            document.getElementById('workspace-dialog-close')?.focus()
            return {
              dialog,
              previous,
              auditEventId: dialog.getAttribute('data-audit-event')
            }
          },
          catch: () => 'DialogUnavailable' as const
        })
      }),
    release: ({ dialog, previous, auditEventId }) =>
      Effect.gen(function* () {
        dialog.close()
        yield* Render.afterCommit
        if (auditEventId !== null) {
          const target =
            document.getElementById(`audit-event-${auditEventId}`) ??
            document.getElementById('table-audit-eventType-trigger')
          target?.focus()
          return
        }
        if (previous instanceof HTMLElement && previous.isConnected) {
          previous.focus()
        }
      }),
    onAcquired: () => Message.cases.Noop.make({}),
    onReleased: () => Message.cases.Noop.make({}),
    onAcquireError: () => Message.cases.Close.make({})
  })
}))

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  investigation: entry(
    { id: Schema.NullOr(Schema.String) },
    {
      modelToDependencies: (model) => ({
        id:
          model.ready &&
          !model.flags.preview &&
          model.page._tag === 'assistant' &&
          model.assistant.selectedTask?.status === 'approved' &&
          model.assistant.selectedTask.outcome === 'pending'
            ? model.assistant.selectedTask.id
            : null
      }),
      dependenciesToStream: ({ id }) =>
        id === null
          ? Stream.empty
          : Stream.tick('5 seconds').pipe(
              Stream.drop(1),
              Stream.map(() =>
                Message.cases.Perform.make({ action: { _tag: 'ReadTask', id } })
              )
            )
    }
  ),
  billing: entry(
    { active: Schema.Boolean, delayed: Schema.Boolean },
    {
      modelToDependencies: (model) => ({
        active:
          model.ready &&
          !model.flags.preview &&
          model.page._tag === 'billing' &&
          ['pending', 'delayed'].includes(model.page.data.synchronization.status),
        delayed:
          model.page._tag === 'billing' &&
          model.page.data.synchronization.status === 'delayed'
      }),
      dependenciesToStream: ({ active, delayed }) =>
        active
          ? Stream.merge(
              Stream.tick(delayed ? '30 seconds' : '10 seconds').pipe(Stream.drop(1)),
              Stream.fromEventListener(document, 'visibilitychange')
            ).pipe(
              Stream.filter(() => document.visibilityState !== 'hidden'),
              Stream.map(() =>
                Message.cases.Perform.make({ action: { _tag: 'Refresh' } })
              )
            )
          : Stream.empty
    }
  ),
  tablePopover: entry(
    { active: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ active: model.ready }),
      dependenciesToStream: ({ active }) =>
        active
          ? Stream.fromEventListener<ToggleEvent>(document, 'toggle', {
              capture: true
            }).pipe(
              Stream.filterMap((event) =>
                event.target instanceof HTMLElement &&
                event.target.id.startsWith('table-')
                  ? Result.succeed(
                      Message.cases.TablePopover.make({
                        id: event.target.id,
                        open: event.newState === 'open'
                      })
                    )
                  : Result.fail(undefined)
              )
            )
          : Stream.empty
    }
  ),
  history: entry(
    {
      active: Schema.Boolean,
      slug: Schema.String,
      id: Schema.NullOr(Schema.String),
      generation: Schema.Number
    },
    {
      modelToDependencies: (model) => ({
        active:
          model.ready &&
          !model.flags.preview &&
          model.page._tag === 'assistant' &&
          model.assistant.connection !== 'denied',
        slug: model.flags.slug,
        id: model.assistant.conversationId,
        generation: model.assistant.generation
      }),
      dependenciesToStream: ({ active, slug, id, generation }) =>
        active && id !== null ? observe(slug, id, generation) : Stream.empty
    }
  ),
  dialogDismiss: entry(
    { open: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ open: model.dialog !== null }),
      dependenciesToStream: ({ open }) =>
        open
          ? Stream.unwrap(
              Effect.gen(function* () {
                yield* Render.afterCommit
                const dialog = document.getElementById('workspace-dialog')
                return dialog
                  ? Stream.fromEventListener<Event>(dialog, 'cancel').pipe(
                      Stream.map((event) => {
                        event.preventDefault()
                        return Message.cases.Close.make({})
                      })
                    )
                  : Stream.empty
              })
            )
          : Stream.empty
    }
  ),
  navigation: entry(
    { active: Schema.Boolean },
    {
      modelToDependencies: (model) => ({ active: model.ready }),
      dependenciesToStream: ({ active }) =>
        active
          ? Stream.fromEventListener(window, 'popstate').pipe(
              Stream.map(() =>
                Message.cases.Location.make({ url: window.location.href })
              )
            )
          : Stream.empty
    }
  ),
  notifications: entry(
    { active: Schema.Boolean },
    {
      modelToDependencies: (model) => ({
        active: model.ready && !model.flags.preview && model.page._tag === 'dashboard'
      }),
      dependenciesToStream: ({ active }) =>
        active
          ? Stream.tick('30 seconds').pipe(
              Stream.drop(1),
              Stream.map(() =>
                Message.cases.Perform.make({ action: { _tag: 'Refresh' } })
              )
            )
          : Stream.empty
    }
  )
}))
