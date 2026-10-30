import { Option, Schema } from 'effect'
import { Command, ManagedResource, Subscription, type Update } from 'foldkit'
import { defineView } from 'foldkit/submodel'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import * as Shell from '../shared/public-shell'
import * as Docs from '../docs/program'
import * as Home from './home'
import * as Pricing from './pricing'
import * as Help from './help'
import { legalView } from './legal'
import * as ErrorPage from '../error'

export const Page = Schema.TaggedUnion({
  Error: { flags: ErrorPage.Flags },
  Pricing: { flags: Pricing.Flags },
  Help: { flags: Help.Flags },
  Home: { flags: Home.Flags },
  Legal: {
    page: Schema.Literals(['privacy', 'terms']),
    controller: Schema.NullOr(
      Schema.Struct({ name: Schema.String, email: Schema.String })
    )
  },
  Docs: { flags: Docs.Flags }
})
export const Flags = Schema.Struct({ shell: Shell.Flags, page: Page })
export type Flags = typeof Flags.Type
export const Model = Schema.Struct({
  pricing: Schema.NullOr(Pricing.Model),
  help: Schema.NullOr(Help.Model),
  flags: Flags,
  shell: Shell.Model,
  home: Schema.NullOr(Home.Model),
  docs: Schema.NullOr(Docs.Model)
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Pricing: { message: Pricing.Message },
  Help: { message: Help.Message },
  Home: { message: Home.Message },
  Shell: { message: Shell.Message },
  Docs: { message: Docs.Message }
})
export type Message = typeof Message.Type
function pricingMessage(message: Pricing.Message): Message {
  return Message.cases.Pricing.make({ message })
}
function helpMessage(message: Help.Message): Message {
  return Message.cases.Help.make({ message })
}
function shellMessage(message: Shell.Message): Message {
  return Message.cases.Shell.make({ message })
}
function docsMessage(message: Docs.Message): Message {
  return Message.cases.Docs.make({ message })
}
function homeMessage(message: Home.Message): Message {
  return Message.cases.Home.make({ message })
}
export function init(flags: Flags): Update.Return<Model, Message> {
  const pricing = flags.page._tag === 'Pricing' ? Pricing.init(flags.page.flags) : null
  const help = flags.page._tag === 'Help' ? Help.init(flags.page.flags) : null
  const shell = Shell.init(flags.shell)
  const home = flags.page._tag === 'Home' ? Home.init(flags.page.flags) : null
  const docs = flags.page._tag === 'Docs' ? Docs.init(flags.page.flags) : null
  return {
    model: {
      flags,
      shell: shell.model,
      docs: docs?.model ?? null,
      home: home?.model ?? null,
      pricing: pricing?.model ?? null,
      help: help?.model ?? null
    },
    commands: [
      ...(home?.commands ?? []).map((command) =>
        Command.mapMessage(command, homeMessage)
      ),
      ...(shell.commands ?? []).map((command) =>
        Command.mapMessage(command, shellMessage)
      ),
      ...(docs?.commands ?? []).map((command) =>
        Command.mapMessage(command, docsMessage)
      )
    ]
  }
}
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'Pricing': {
      if (model.pricing === null) {
        return { model }
      }
      const result = Pricing.update(model.pricing, message.message)
      return {
        model: { ...model, pricing: result.model },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, pricingMessage)
        )
      }
    }
    case 'Help': {
      if (model.help === null) {
        return { model }
      }
      const result = Help.update(model.help, message.message)
      return {
        model: { ...model, help: result.model },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, helpMessage)
        )
      }
    }
    case 'Home': {
      if (model.home === null) {
        return { model }
      }
      const result = Home.update(model.home, message.message)
      return {
        model: { ...model, home: result.model },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, homeMessage)
        )
      }
    }
    case 'Shell': {
      const result = Shell.update(model.shell, message.message)
      return {
        model: { ...model, shell: result.model },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, shellMessage)
        )
      }
    }
    case 'Docs': {
      if (model.docs === null) {
        return { model }
      }
      const result = Docs.update(model.docs, message.message)
      return {
        model: { ...model, docs: result.model },
        commands: (result.commands ?? []).map((command) =>
          Command.mapMessage(command, docsMessage)
        )
      }
    }
  }
}
const ContentView = defineView<Model, Message>((model, h) => {
  switch (model.flags.page._tag) {
    case 'Error': {
      return ErrorPage.view(model.flags.page.flags, h)
    }
    case 'Pricing': {
      return model.pricing === null
        ? h.div([])
        : h.submodel({
            slotId: 'pricing',
            model: model.pricing,
            view: PricingView,
            toParentMessage: pricingMessage
          })
    }
    case 'Help': {
      return model.help === null
        ? h.div([])
        : h.submodel({
            slotId: 'help',
            model: { config: model.flags.page.flags, help: model.help },
            view: HelpView,
            toParentMessage: helpMessage
          })
    }
    case 'Home': {
      return model.home === null
        ? h.div([])
        : h.submodel({
            slotId: 'home',
            model: model.home,
            view: HomeView,
            toParentMessage: homeMessage
          })
    }
    case 'Legal': {
      return legalView(model.flags.page.page, model.flags.page.controller, h)
    }
    case 'Docs': {
      return h.submodel({
        slotId: 'docs',
        model,
        view: DocsView,
        toParentMessage: docsMessage
      })
    }
  }
})
const DocsView = defineView<Model, Docs.Message>((model, h) =>
  model.docs === null
    ? h.div([])
    : Docs.view(model.docs, h, model.flags.shell.docs, model.flags.shell.path)
)
const HomeView = defineView<Home.Model, Home.Message>(Home.view)
const PricingView = defineView<Pricing.Model, Pricing.Message>(Pricing.view)
const HelpView = defineView<{ config: Help.Flags; help: Help.Model }, Help.Message>(
  (model, h) => Help.view(model.config, model.help, h)
)
const ShellView = defineView<{ shell: Shell.Model; body: Html }, Shell.Message>(
  (model, h) => Shell.view(model.shell, h, model.body)
)

// Keep the content's messages in the public program while the shell receives its own builder.
export function view(model: Model, h: HtmlBuilder<Message>): Html {
  const body = h.submodel({
    slotId: 'public-content',
    model,
    view: ContentView,
    toParentMessage: (message) => message
  })
  return h.submodel({
    slotId: 'public-shell',
    model: { shell: model.shell, body },
    view: ShellView,
    toParentMessage: shellMessage
  })
}
export const subscriptions = {
  ...Subscription.lift(Home.subscriptions)<Model, Message>({
    read: (model) => Option.fromNullishOr(model.home),
    toParentMessage: homeMessage
  }),
  ...Subscription.lift(Shell.subscriptions)<Model, Message>({
    read: (model) => Option.some(model.shell),
    toParentMessage: shellMessage
  }),
  ...Subscription.lift(Docs.subscriptions)<Model, Message>({
    read: (model) => Option.fromNullishOr(model.docs),
    toParentMessage: docsMessage
  })
}
export const managedResources = {
  ...ManagedResource.lift(Shell.managedResources)<Model, Message>({
    read: (model) => Option.some(model.shell),
    toParentMessage: shellMessage
  }),
  ...ManagedResource.lift(Home.managedResources)<Model, Message>({
    read: (model) => Option.fromNullishOr(model.home),
    toParentMessage: homeMessage
  })
}
