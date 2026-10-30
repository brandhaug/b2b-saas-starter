import { Effect, Option, Queue, Schema, Stream } from 'effect'
import { Command, ManagedResource, Subscription, type Update } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import { defineView } from 'foldkit/submodel'
import { PageData } from '@/http/page-contract'
import { safeRedirect } from '@/lib/utils'
import { m } from '@b2b-saas-starter/i18n/messages'
import { link } from '../shared/view'
import { heading } from './ui'
import * as Security from './security'
import * as Personal from './personal'
import * as Notifications from './notifications'
import * as Directory from './directory'
import * as Admin from './admin'
import * as Email from './email'

export const Flags = Schema.Struct({ search: Schema.String, data: PageData })
export type Flags = typeof Flags.Type
export const Model = Schema.Struct({
  flags: Flags,
  security: Schema.NullOr(Security.Model),
  personal: Schema.NullOr(Personal.Model),
  notifications: Schema.NullOr(Notifications.Model),
  directory: Schema.NullOr(Directory.Model),
  admin: Schema.NullOr(Admin.Model),
  email: Schema.NullOr(Email.Model)
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Ready: {},
  Dom: {},
  Dismissed: {},
  CreateDismissed: {},
  Security: { message: Security.Message },
  Personal: { message: Personal.Message },
  Notifications: { message: Notifications.Message },
  Directory: { message: Directory.Message },
  Admin: { message: Admin.Message },
  Email: { message: Email.Message }
})
export type Message = typeof Message.Type
function securityMessage(message: Security.Message): Message {
  return { _tag: 'Security', message }
}
function personalMessage(message: Personal.Message): Message {
  return { _tag: 'Personal', message }
}
function notificationsMessage(message: Notifications.Message): Message {
  return { _tag: 'Notifications', message }
}
function directoryMessage(message: Directory.Message): Message {
  return { _tag: 'Directory', message }
}
function adminMessage(message: Admin.Message): Message {
  return { _tag: 'Admin', message }
}
function emailMessage(message: Email.Message): Message {
  return { _tag: 'Email', message }
}
const Ready = Command.define('AccountAdmin.Ready', {
  messages: [Message.cases.Ready],
  execute: Effect.succeed(Message.cases.Ready.make({}))
})

export function flagsForPage(url: URL, data: PageData): Flags {
  return { search: url.search, data }
}
export function init(flags: Flags): Update.Return<Model, Message> {
  let model: Model = {
    flags,
    security: null,
    personal: null,
    notifications: null,
    directory: null,
    admin: null,
    email: null
  }
  const commands: Array<Command.Command<Message>> = [Ready()]
  const page = flags.data.page
  const session = flags.data.session
  if (!session || !page) {
    return { model }
  }
  switch (page._tag) {
    case 'account': {
      const security = Security.init(
        session.user.name,
        session.user.twoFactorEnabled,
        session.impersonatedBy !== null
      )
      model = {
        ...model,
        security: security.model,
        personal: Personal.init({
          account: page.data,
          connections: page.connections,
          conversations: page.ownedConversations,
          impersonating: session.impersonatedBy !== null,
          locale: flags.data.locale,
          timeZone: flags.data.presentation.timeZone
        }).model,
        notifications: Notifications.init(page.data.preferences, [], flags.search).model
      }
      commands.push(
        ...(security.commands ?? []).map((command) =>
          Command.mapMessage(command, securityMessage)
        )
      )
      break
    }
    case 'account-notifications': {
      model = {
        ...model,
        notifications: Notifications.init(
          page.data.preferences,
          page.deliveries,
          flags.search
        ).model,
        email: Email.init({
          email: session.user.email,
          verified: session.user.emailVerified,
          siteKey: page.turnstileSiteKey,
          recovery: true,
          callbackPath: '/account'
        }).model
      }
      break
    }
    case 'directory': {
      model = {
        ...model,
        directory: Directory.init({
          purchasePage: false,
          validIntent: false,
          purchase: null,
          directory: flags.data.directory ?? []
        }).model,
        email: session.user.emailVerified
          ? null
          : Email.init({
              email: session.user.email,
              verified: false,
              siteKey: page.turnstileSiteKey,
              recovery: false,
              callbackPath: '/workspaces'
            }).model
      }
      break
    }
    case 'purchase': {
      model = {
        ...model,
        directory: Directory.init({
          purchasePage: true,
          validIntent: new URLSearchParams(flags.search).get('plan') === 'team',
          purchase: page.data,
          directory: []
        }).model,
        email: page.data?.emailVerificationRequired
          ? Email.init({
              email: session.user.email,
              verified: false,
              siteKey: page.turnstileSiteKey,
              recovery: false,
              callbackPath: '/purchase?plan=team'
            }).model
          : null
      }
      break
    }
    case 'admin': {
      model = { ...model, admin: Admin.init({ ...page, search: flags.search }).model }
      break
    }
    case 'api-tokens':
    case 'assistant':
    case 'audit':
    case 'auth':
    case 'billing':
    case 'consent':
    case 'dashboard':
    case 'invitation':
    case 'members':
    case 'pricing':
    case 'public':
    case 'help':
    case 'settings':
    case 'suspended':
    case 'verification':
    case 'webhooks': {
      break
    }
  }
  return { model, commands }
}
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'Ready': {
      return {
        model: {
          ...model,
          security: model.security ? { ...model.security, ready: true } : null,
          personal: model.personal ? { ...model.personal, ready: true } : null,
          notifications: model.notifications
            ? { ...model.notifications, ready: true }
            : null,
          directory: model.directory ? { ...model.directory, ready: true } : null,
          admin: model.admin ? { ...model.admin, ready: true } : null,
          email: model.email ? { ...model.email, ready: true } : null
        }
      }
    }
    case 'Dom': {
      return { model }
    }
    case 'Dismissed': {
      if (model.security?.confirming) {
        return update(model, securityMessage({ _tag: 'Cancelled' }))
      }
      if (model.personal?.confirming) {
        return update(model, personalMessage({ _tag: 'Cancelled' }))
      }
      if (model.admin?.confirming) {
        return update(model, adminMessage({ _tag: 'Cancelled' }))
      }
      return { model }
    }
    case 'CreateDismissed': {
      return update(model, directoryMessage({ _tag: 'Closed' }))
    }
    case 'Security': {
      if (!model.security) {
        return { model }
      }
      const result = Security.update(model.security, message.message)
      return {
        model: { ...model, security: result.model },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, securityMessage)
        )
      }
    }
    case 'Personal': {
      if (!model.personal) {
        return { model }
      }
      if (
        message.message._tag === 'Requested' &&
        message.message.operation._tag === 'Preferences'
      ) {
        const fields = model.security?.fields
        const dirtySecurity =
          fields &&
          (fields.name !== model.flags.data.session?.user.name ||
            fields.currentPassword ||
            fields.newPassword ||
            fields.confirmPassword ||
            fields.enablePassword ||
            fields.disablePassword ||
            fields.regeneratePassword ||
            fields.code ||
            fields.passkeyName ||
            fields.rename)
        if (dirtySecurity || model.personal.password) {
          return {
            model: {
              ...model,
              personal: { ...model.personal, confirming: { _tag: 'Preferences' } }
            }
          }
        }
      }
      const result = Personal.update(model.personal, message.message)
      return {
        model: { ...model, personal: result.model },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, personalMessage)
        )
      }
    }
    case 'Notifications': {
      if (!model.notifications) {
        return { model }
      }
      const result = Notifications.update(model.notifications, message.message)
      return {
        model: { ...model, notifications: result.model },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, notificationsMessage)
        )
      }
    }
    case 'Directory': {
      if (!model.directory) {
        return { model }
      }
      const result = Directory.update(model.directory, message.message)
      return {
        model: { ...model, directory: result.model },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, directoryMessage)
        )
      }
    }
    case 'Admin': {
      if (!model.admin) {
        return { model }
      }
      const result = Admin.update(model.admin, message.message)
      return {
        model: { ...model, admin: result.model },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, adminMessage)
        )
      }
    }
    case 'Email': {
      if (!model.email) {
        return { model }
      }
      const result = Email.update(model.email, message.message)
      return {
        model: { ...model, email: result.model },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, emailMessage)
        )
      }
    }
  }
}
const SecurityView = defineView<Security.Model, Security.Message>((model, h) =>
  Security.view(model, h, 'credentials')
)
const SessionsView = defineView<Security.Model, Security.Message>((model, h) =>
  Security.view(model, h, 'sessions')
)
const PersonalView = defineView<Personal.Model, Personal.Message>((model, h) =>
  Personal.view(model, h, 'data')
)
const AccountActionsView = defineView<Personal.Model, Personal.Message>((model, h) =>
  Personal.view(model, h, 'deletion-connections')
)
const NotificationsView = defineView<Notifications.Model, Notifications.Message>(
  (model, h) => Notifications.view(model, h, false)
)
const NotificationDeliveryView = defineView<Notifications.Model, Notifications.Message>(
  (model, h) => Notifications.view(model, h, true)
)
const DirectoryView = defineView<Directory.Model, Directory.Message>(Directory.view)
const AdminView = defineView<Admin.Model, Admin.Message>(Admin.view)
const EmailView = defineView<Email.Model, Email.Message>(Email.view)
export function view(model: Model, h: HtmlBuilder<Message>): Html {
  const children: Array<Html> = []
  const page = model.flags.data.page?._tag
  if (page === 'account') {
    const redirect = new URLSearchParams(model.flags.search).get('redirect')
    if (redirect) {
      children.push(link(h, safeRedirect(redirect), m.continue_action()))
    }
    children.push(
      heading(h, m.page_account(), m.page_account_description()),
      link(
        h,
        `/verify-authentication${redirect ? `?redirect=${encodeURIComponent(safeRedirect(redirect))}` : ''}`,
        m.security_verify_title()
      )
    )
  }
  if (page === 'account-notifications') {
    children.push(
      heading(
        h,
        m.notification_preferences(),
        m.notification_preferences_description()
      ),
      h.p([], [m.signed_in_as({ email: model.flags.data.session?.user.email ?? '' })])
    )
  }
  if (model.email && (page === 'directory' || page === 'purchase')) {
    children.push(
      h.submodel({
        slotId: 'account-email',
        model: model.email,
        view: EmailView,
        toParentMessage: emailMessage
      })
    )
  }
  if (model.directory) {
    children.push(
      h.submodel({
        slotId: 'account-directory',
        model: model.directory,
        view: DirectoryView,
        toParentMessage: directoryMessage
      })
    )
  }
  if (model.security) {
    children.push(
      h.submodel({
        slotId: 'account-security',
        model: model.security,
        view: SecurityView,
        toParentMessage: securityMessage
      })
    )
  }
  if (model.personal) {
    children.push(
      h.submodel({
        slotId: 'account-personal',
        model: model.personal,
        view: PersonalView,
        toParentMessage: personalMessage
      })
    )
  }
  if (model.security) {
    children.push(
      h.submodel({
        slotId: 'account-sessions',
        model: model.security,
        view: SessionsView,
        toParentMessage: securityMessage
      })
    )
  }
  if (model.notifications) {
    children.push(
      h.submodel({
        slotId: 'account-notifications',
        model: model.notifications,
        view:
          page === 'account-notifications'
            ? NotificationDeliveryView
            : NotificationsView,
        toParentMessage: notificationsMessage
      })
    )
  }
  if (model.personal) {
    children.push(
      h.submodel({
        slotId: 'account-actions',
        model: model.personal,
        view: AccountActionsView,
        toParentMessage: personalMessage
      })
    )
  }
  if (model.email && page === 'account-notifications') {
    children.push(
      h.submodel({
        slotId: 'account-email',
        model: model.email,
        view: EmailView,
        toParentMessage: emailMessage
      })
    )
  }
  if (model.admin) {
    children.push(
      h.submodel({
        slotId: 'system-admin',
        model: model.admin,
        view: AdminView,
        toParentMessage: adminMessage
      })
    )
  }
  return h.div(
    [
      h.Class(
        `mx-auto grid w-full gap-6 ${page === 'admin' ? 'max-w-7xl' : 'max-w-4xl'}`
      )
    ],
    children
  )
}
function confirmOpen(model: Model): boolean {
  return Boolean(
    model.security?.confirming || model.personal?.confirming || model.admin?.confirming
  )
}
const Dialog = ManagedResource.tag<{
  dialog: HTMLDialogElement
  trigger: HTMLElement | null
}>()('AccountAdmin.Dialog')
const CreateDialog = ManagedResource.tag<{
  dialog: HTMLDialogElement
  trigger: HTMLElement | null
}>()('AccountAdmin.CreateDialog')
function acquire(id: string) {
  return Effect.suspend(() => {
    const trigger =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Resource requirements change before the animation-frame DOM commit.
    // Observe the mount rather than treating that interval as a dismissal.
    return Effect.callback<HTMLDialogElement>((resume) => {
      const observer = new MutationObserver(findDialog)
      function findDialog() {
        const dialog = document.getElementById(id)
        if (dialog instanceof HTMLDialogElement && dialog.isConnected) {
          observer.disconnect()
          resume(Effect.succeed(dialog))
        }
      }
      observer.observe(document.body, { childList: true, subtree: true })
      findDialog()
      return Effect.sync(() => observer.disconnect())
    }).pipe(
      Effect.interruptible,
      Effect.flatMap((dialog) =>
        Effect.try({
          try: () => {
            dialog.showModal()
            return { dialog, trigger }
          },
          catch: () => 'MissingDialog' as const
        })
      )
    )
  })
}
const dialogs = ManagedResource.make<Model, Message>()((entry) => ({
  confirmation: entry(Schema.Option(Schema.Null), {
    resource: Dialog,
    modelToMaybeRequirements: (model) =>
      confirmOpen(model) ? Option.some(null) : Option.none(),
    acquire: () => acquire('account-admin-confirm'),
    release: ({ dialog, trigger }) =>
      Effect.sync(() => {
        dialog.close()
        trigger?.focus()
      }),
    onAcquired: () => ({ _tag: 'Dom' }),
    onReleased: () => ({ _tag: 'Dom' }),
    onAcquireError: () => ({ _tag: 'Dismissed' })
  }),
  create: entry(Schema.Option(Schema.Null), {
    resource: CreateDialog,
    modelToMaybeRequirements: (model) =>
      model.directory?.createOpen ? Option.some(null) : Option.none(),
    acquire: () => acquire('account-admin-create'),
    release: ({ dialog, trigger }) =>
      Effect.sync(() => {
        dialog.close()
        trigger?.focus()
      }),
    onAcquired: () => ({ _tag: 'Dom' }),
    onReleased: () => ({ _tag: 'Dom' }),
    onAcquireError: () => ({ _tag: 'CreateDismissed' })
  })
}))
function dismiss(id: string, message: Message) {
  return Stream.callback<Message>((queue) => {
    function cancel(event: Event) {
      if (!(event.target instanceof HTMLDialogElement) || event.target.id !== id) {
        return
      }
      // Prevent native closure synchronously, before queuing the model update.
      event.preventDefault()
      Queue.offerUnsafe(queue, message)
    }
    return Effect.acquireRelease(
      Effect.sync(() => {
        // Native cancel does not bubble; capture covers dialogs mounted later.
        document.addEventListener('cancel', cancel, true)
        return cancel
      }),
      (listener) =>
        Effect.sync(() => document.removeEventListener('cancel', listener, true))
    )
  })
}
export const managedResources = dialogs
export const subscriptions = {
  ...Subscription.lift(Email.subscriptions)<Model, Message>({
    read: (model) => Option.fromNullishOr(model.email),
    toParentMessage: emailMessage
  }),
  ...Subscription.make<Model, Message>()((entry) => ({
    tableHistory: entry(
      { active: Schema.Boolean },
      {
        modelToDependencies: (model) => ({
          active: model.admin !== null || model.notifications !== null
        }),
        dependenciesToStream: ({ active }) =>
          active
            ? Stream.unwrap(
                Effect.sync(() =>
                  Stream.fromEventListener<PopStateEvent>(window, 'popstate').pipe(
                    Stream.map(() => {
                      window.location.reload()
                      return Message.cases.Dom.make({})
                    })
                  )
                )
              )
            : Stream.empty
      }
    ),
    confirmationDismiss: entry(
      { open: Schema.Boolean },
      {
        modelToDependencies: (model) => ({ open: confirmOpen(model) }),
        dependenciesToStream: ({ open }) =>
          open ? dismiss('account-admin-confirm', { _tag: 'Dismissed' }) : Stream.empty
      }
    ),
    createDismiss: entry(
      { open: Schema.Boolean },
      {
        modelToDependencies: (model) => ({
          open: model.directory?.createOpen ?? false
        }),
        dependenciesToStream: ({ open }) =>
          open
            ? dismiss('account-admin-create', { _tag: 'CreateDismissed' })
            : Stream.empty
      }
    )
  }))
}
