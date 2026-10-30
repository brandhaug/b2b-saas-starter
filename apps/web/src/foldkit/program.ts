import { Option, Schema } from 'effect'
import { Command, ManagedResource, Runtime, Subscription, type Update } from 'foldkit'
import { type Document, type Html, type HtmlBuilder } from 'foldkit/html'
import { defineView } from 'foldkit/submodel'
import * as Auth from './auth/model'
import { init as authInit, update as authUpdate } from './auth/update'
import { view as authView } from './auth/view'
import {
  managedResources as authResources,
  subscriptions as authSubscriptions
} from './auth/resources'
import * as Consent from './consent'
import * as Invitation from './invitation'
import * as Public from './public/program'
import * as ErrorPage from './error'
import * as Environment from './shared/environment'
import * as Workspace from './workspace'
import * as AccountAdmin from './account-admin'
import * as Shell from './shared/application-shell'

export const Presentation = Schema.Struct({
  timeZone: Schema.String,
  authenticated: Schema.Boolean,
  needsTimeZone: Schema.Boolean
})

export const PageFlags = Schema.TaggedUnion({
  ApplicationError: { flags: ErrorPage.Flags, shell: Shell.Flags },
  Workspace: { flags: Workspace.Flags, shell: Shell.Flags },
  AccountAdmin: { flags: AccountAdmin.Flags, shell: Shell.Flags },
  Auth: { flags: Auth.Flags },
  Consent: { flags: Consent.Flags },
  Invitation: { flags: Invitation.Flags },
  Public: { flags: Public.Flags },
  Error: { flags: ErrorPage.Flags }
})
export const Flags = Schema.Struct({
  analyticsToken: Schema.NullOr(Schema.String),
  page: PageFlags,
  title: Schema.String,
  locale: Schema.Literals(['en', 'nb']),
  presentation: Presentation,
  canonical: Schema.NullOr(Schema.String)
})
export type Flags = typeof Flags.Type
const PageModel = Schema.TaggedUnion({
  ApplicationError: { flags: ErrorPage.Flags, shell: Shell.Model },
  Workspace: { model: Workspace.Model, shell: Shell.Model },
  AccountAdmin: { model: AccountAdmin.Model, shell: Shell.Model },
  Auth: { model: Auth.Model },
  Consent: { model: Consent.Model },
  Invitation: { model: Invitation.Model },
  Public: { model: Public.Model }
})
export const Model = Schema.Struct({
  environment: Environment.Model,
  presentation: Presentation,
  page: PageModel,
  title: Schema.String,
  locale: Schema.Literals(['en', 'nb']),
  canonical: Schema.NullOr(Schema.String)
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Workspace: { message: Workspace.Message },
  AccountAdmin: { message: AccountAdmin.Message },
  Shell: { message: Shell.Message },
  Environment: { message: Environment.Message },
  Auth: { message: Auth.Message },
  Consent: { message: Consent.Message },
  Invitation: { message: Invitation.Message },
  Public: { message: Public.Message }
})
export type Message = typeof Message.Type
function workspaceMessage(message: Workspace.Message): Message {
  return Message.cases.Workspace.make({ message })
}
function accountAdminMessage(message: AccountAdmin.Message): Message {
  return Message.cases.AccountAdmin.make({ message })
}
function shellMessage(message: Shell.Message): Message {
  return Message.cases.Shell.make({ message })
}
function environmentMessage(message: Environment.Message): Message {
  return Message.cases.Environment.make({ message })
}

function authMessage(message: Auth.Message): Message {
  return Message.cases.Auth.make({ message })
}
function consentMessage(message: Consent.Message): Message {
  return Message.cases.Consent.make({ message })
}
function invitationMessage(message: Invitation.Message): Message {
  return Message.cases.Invitation.make({ message })
}
function publicMessage(message: Public.Message): Message {
  return Message.cases.Public.make({ message })
}

export function init(flags: Flags): Update.Return<Model, Message> {
  const environment = Environment.init({
    token: flags.analyticsToken,
    authenticated: flags.presentation.authenticated,
    needsTimeZone: flags.presentation.needsTimeZone
  })
  const result = initPage(flags, environment.model)
  return {
    model: result.model,
    commands: [
      ...(result.commands ?? []),
      ...(environment.commands ?? []).map((command) =>
        Command.mapMessage(command, environmentMessage)
      )
    ]
  }
}

function initPage(
  flags: Flags,
  environment: Environment.Model
): Update.Return<Model, Message> {
  const metadata = {
    environment,
    presentation: flags.presentation,
    title: flags.title,
    locale: flags.locale,
    canonical: flags.canonical
  }
  switch (flags.page._tag) {
    case 'ApplicationError': {
      const shell = Shell.init(flags.page.shell)
      return {
        model: {
          ...metadata,
          page: {
            _tag: 'ApplicationError',
            flags: flags.page.flags,
            shell: shell.model
          }
        },
        commands: (shell.commands ?? []).map((command) =>
          Command.mapMessage(command, shellMessage)
        )
      }
    }
    case 'Workspace': {
      const result = Workspace.init(flags.page.flags)
      const shell = Shell.init(flags.page.shell)
      return {
        model: {
          ...metadata,
          page: { _tag: 'Workspace', model: result.model, shell: shell.model }
        },
        commands: [
          ...(result.commands ?? []).map((command) =>
            Command.mapMessage(command, workspaceMessage)
          ),
          ...(shell.commands ?? []).map((command) =>
            Command.mapMessage(command, shellMessage)
          )
        ]
      }
    }
    case 'AccountAdmin': {
      const result = AccountAdmin.init(flags.page.flags)
      const shell = Shell.init(flags.page.shell)
      return {
        model: {
          ...metadata,
          page: { _tag: 'AccountAdmin', model: result.model, shell: shell.model }
        },
        commands: [
          ...(result.commands ?? []).map((command) =>
            Command.mapMessage(command, accountAdminMessage)
          ),
          ...(shell.commands ?? []).map((command) =>
            Command.mapMessage(command, shellMessage)
          )
        ]
      }
    }
    case 'Error': {
      return initPage(
        {
          ...flags,
          page: {
            _tag: 'Public',
            flags: {
              shell: {
                signedIn: flags.presentation.authenticated,
                locale: flags.locale,
                path: flags.page.flags.returnTo ?? '/',
                docs: []
              },
              page: { _tag: 'Error', flags: flags.page.flags }
            }
          }
        },
        environment
      )
    }
    case 'Public': {
      const result = Public.init(flags.page.flags)
      return {
        model: {
          ...metadata,
          page: PageModel.cases.Public.make({ model: result.model })
        },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, publicMessage)
        )
      }
    }
    case 'Auth': {
      const result = authInit(flags.page.flags)
      return {
        model: {
          ...metadata,
          page: PageModel.cases.Auth.make({ model: result.model })
        },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, authMessage)
        )
      }
    }
    case 'Consent': {
      const result = Consent.init(flags.page.flags)
      return {
        model: {
          ...metadata,
          page: PageModel.cases.Consent.make({ model: result.model })
        },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, consentMessage)
        )
      }
    }
    case 'Invitation': {
      const result = Invitation.init(flags.page.flags)
      return {
        model: {
          ...metadata,
          page: PageModel.cases.Invitation.make({ model: result.model })
        },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, invitationMessage)
        )
      }
    }
  }
}

export function update(model: Model, message: Message): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'Shell': {
      if (
        model.page._tag !== 'Workspace' &&
        model.page._tag !== 'AccountAdmin' &&
        model.page._tag !== 'ApplicationError'
      ) {
        return { model }
      }
      const result = Shell.update(model.page.shell, message.message)
      return {
        model: { ...model, page: { ...model.page, shell: result.model } },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, shellMessage)
        )
      }
    }
    case 'Workspace': {
      if (model.page._tag !== 'Workspace') {
        return { model }
      }
      const result = Workspace.update(model.page.model, message.message)
      return {
        model: { ...model, page: { ...model.page, model: result.model } },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, workspaceMessage)
        )
      }
    }
    case 'AccountAdmin': {
      if (model.page._tag !== 'AccountAdmin') {
        return { model }
      }
      const result = AccountAdmin.update(model.page.model, message.message)
      return {
        model: { ...model, page: { ...model.page, model: result.model } },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, accountAdminMessage)
        )
      }
    }
    case 'Environment': {
      const result = Environment.update(model.environment, message.message)
      return {
        model: { ...model, environment: result.model },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, environmentMessage)
        )
      }
    }
    case 'Public': {
      if (model.page._tag !== 'Public') {
        return { model }
      }
      const result = Public.update(model.page.model, message.message)
      return {
        model: { ...model, page: PageModel.cases.Public.make({ model: result.model }) },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, publicMessage)
        )
      }
    }
    case 'Auth': {
      if (model.page._tag !== 'Auth') {
        return { model }
      }
      const result = authUpdate(model.page.model, message.message)
      return {
        model: { ...model, page: PageModel.cases.Auth.make({ model: result.model }) },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, authMessage)
        )
      }
    }
    case 'Consent': {
      if (model.page._tag !== 'Consent') {
        return { model }
      }
      const result = Consent.update(model.page.model, message.message)
      return {
        model: {
          ...model,
          page: PageModel.cases.Consent.make({ model: result.model })
        },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, consentMessage)
        )
      }
    }
    case 'Invitation': {
      if (model.page._tag !== 'Invitation') {
        return { model }
      }
      const result = Invitation.update(model.page.model, message.message)
      return {
        model: {
          ...model,
          page: PageModel.cases.Invitation.make({ model: result.model })
        },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, invitationMessage)
        )
      }
    }
  }
}

const AuthView = defineView<Auth.Model, Auth.Message>(authView)
const WorkspaceView = defineView<Workspace.Model, Workspace.Message>(Workspace.view)
const AccountAdminView = defineView<AccountAdmin.Model, AccountAdmin.Message>(
  AccountAdmin.view
)
const ShellView = defineView<{ shell: Shell.Model; body: Html }, Shell.Message>(
  (model, h) => Shell.view(model.shell, h, model.body)
)
const EnvironmentView = defineView<Environment.Model, Environment.Message>(
  Environment.view
)
const PublicView = defineView<Public.Model, Public.Message>(Public.view)
const ConsentView = defineView<Consent.Model, Consent.Message>(Consent.view)
const InvitationView = defineView<Invitation.Model, Invitation.Message>(Invitation.view)
type PageMetadata = { -readonly [K in keyof Omit<Document, 'body'>]: Document[K] }

export function view(model: Model, h: HtmlBuilder<Message>): Document {
  const page = pageDocument(model, h)
  return {
    ...page,
    body: h.div(
      [],
      [
        page.body,
        h.submodel({
          slotId: 'environment',
          model: model.environment,
          view: EnvironmentView,
          toParentMessage: environmentMessage
        })
      ]
    )
  }
}

function pageDocument(model: Model, h: HtmlBuilder<Message>): Document {
  const metadata: PageMetadata = {
    title: model.title,
    lang: model.locale
  }
  if (model.canonical !== null) {
    metadata.canonical = model.canonical
  }
  switch (model.page._tag) {
    case 'Workspace': {
      const body = h.submodel({
        slotId: 'workspace',
        model: model.page.model,
        view: WorkspaceView,
        toParentMessage: workspaceMessage
      })
      return {
        ...metadata,
        body: h.submodel({
          slotId: 'application-shell',
          model: { shell: model.page.shell, body },
          view: ShellView,
          toParentMessage: shellMessage
        })
      }
    }
    case 'AccountAdmin': {
      const body = h.submodel({
        slotId: 'account-admin',
        model: model.page.model,
        view: AccountAdminView,
        toParentMessage: accountAdminMessage
      })
      return {
        ...metadata,
        body: h.submodel({
          slotId: 'application-shell',
          model: { shell: model.page.shell, body },
          view: ShellView,
          toParentMessage: shellMessage
        })
      }
    }
    case 'ApplicationError': {
      return {
        ...metadata,
        body: h.submodel({
          slotId: 'application-shell',
          model: {
            shell: model.page.shell,
            body: ErrorPage.view(model.page.flags, h, true)
          },
          view: ShellView,
          toParentMessage: shellMessage
        })
      }
    }
    case 'Public': {
      return {
        ...metadata,
        body: h.submodel({
          slotId: 'public',
          model: model.page.model,
          view: PublicView,
          toParentMessage: publicMessage
        })
      }
    }
    case 'Auth': {
      return {
        ...metadata,
        body: h.submodel({
          slotId: 'auth',
          model: model.page.model,
          view: AuthView,
          toParentMessage: authMessage
        })
      }
    }
    case 'Consent': {
      return {
        ...metadata,
        body: h.submodel({
          slotId: 'consent',
          model: model.page.model,
          view: ConsentView,
          toParentMessage: consentMessage
        })
      }
    }
    case 'Invitation': {
      return {
        ...metadata,
        body: h.submodel({
          slotId: 'invitation',
          model: model.page.model,
          view: InvitationView,
          toParentMessage: invitationMessage
        })
      }
    }
  }
}

function namespace<Value>(
  prefix: string,
  entries: Readonly<Record<string, Value>>
): Record<string, Value> {
  return Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [`${prefix}.${key}`, value])
  )
}

export const subscriptions = {
  ...namespace(
    'workspace',
    Subscription.lift(Workspace.subscriptions)<Model, Message>({
      read: (model) =>
        model.page._tag === 'Workspace' ? Option.some(model.page.model) : Option.none(),
      toParentMessage: workspaceMessage
    })
  ),
  ...namespace(
    'accountAdmin',
    Subscription.lift(AccountAdmin.subscriptions)<Model, Message>({
      read: (model) =>
        model.page._tag === 'AccountAdmin'
          ? Option.some(model.page.model)
          : Option.none(),
      toParentMessage: accountAdminMessage
    })
  ),
  ...namespace(
    'shell',
    Subscription.lift(Shell.subscriptions)<Model, Message>({
      read: (model) =>
        model.page._tag === 'Workspace' ||
        model.page._tag === 'AccountAdmin' ||
        model.page._tag === 'ApplicationError'
          ? Option.some(model.page.shell)
          : Option.none(),
      toParentMessage: shellMessage
    })
  ),
  ...Subscription.lift(Environment.subscriptions)<Model, Message>({
    read: (model) => Option.some(model.environment),
    toParentMessage: environmentMessage
  }),
  ...Subscription.lift(authSubscriptions)<Model, Message>({
    read: (model) =>
      model.page._tag === 'Auth' ? Option.some(model.page.model) : Option.none(),
    toParentMessage: authMessage
  }),
  ...Subscription.lift(Public.subscriptions)<Model, Message>({
    read: (model) =>
      model.page._tag === 'Public' ? Option.some(model.page.model) : Option.none(),
    toParentMessage: publicMessage
  })
}
export const managedResources = {
  ...namespace(
    'workspace',
    ManagedResource.lift(Workspace.managedResources)<Model, Message>({
      read: (model) =>
        model.page._tag === 'Workspace' ? Option.some(model.page.model) : Option.none(),
      toParentMessage: workspaceMessage
    })
  ),
  ...namespace(
    'accountAdmin',
    ManagedResource.lift(AccountAdmin.managedResources)<Model, Message>({
      read: (model) =>
        model.page._tag === 'AccountAdmin'
          ? Option.some(model.page.model)
          : Option.none(),
      toParentMessage: accountAdminMessage
    })
  ),
  ...namespace(
    'shell',
    ManagedResource.lift(Shell.managedResources)<Model, Message>({
      read: (model) =>
        model.page._tag === 'Workspace' ||
        model.page._tag === 'AccountAdmin' ||
        model.page._tag === 'ApplicationError'
          ? Option.some(model.page.shell)
          : Option.none(),
      toParentMessage: shellMessage
    })
  ),
  ...ManagedResource.lift(Environment.managedResources)<Model, Message>({
    read: (model) => Option.some(model.environment),
    toParentMessage: environmentMessage
  }),
  ...ManagedResource.lift(authResources)<Model, Message>({
    read: (model) =>
      model.page._tag === 'Auth' ? Option.some(model.page.model) : Option.none(),
    toParentMessage: authMessage
  }),
  ...ManagedResource.lift(Public.managedResources)<Model, Message>({
    read: (model) =>
      model.page._tag === 'Public' ? Option.some(model.page.model) : Option.none(),
    toParentMessage: publicMessage
  })
}

export const serverProgram = { Flags, init, view }
export function application(container: HTMLElement | null) {
  return Runtime.makeApplication({
    Flags,
    Model,
    init,
    update,
    view,
    container,
    subscriptions,
    managedResources
  })
}
