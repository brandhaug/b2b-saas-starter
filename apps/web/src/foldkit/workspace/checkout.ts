import { Command, type Update } from 'foldkit'
import { defineView } from 'foldkit/submodel'
import { purchaseIntent } from '@/lib/purchase-intent'
import * as Checkout from '../account-admin/checkout'
import { type Model, type Message } from './model'

export const view = defineView<Checkout.Model, Checkout.Message>(Checkout.view)

export function message(childMessage: Checkout.Message): Message {
  return { _tag: 'Checkout', message: childMessage }
}

export function synchronize(
  result: Update.Return<Model, Message>
): Update.Return<Model, Message> {
  const model = result.model
  const intent = purchaseIntent(
    new URL(model.url).searchParams.get('purchase') ?? undefined
  )
  if (model.flags.preview || model.page._tag !== 'billing' || intent === null) {
    return model.checkout === null
      ? result
      : { ...result, model: { ...model, checkout: null } }
  }
  const flags = { workspaceSlug: model.flags.slug, data: model.page.data }
  if (model.checkout !== null) {
    return { ...result, model: { ...model, checkout: { ...model.checkout, flags } } }
  }
  const child = Checkout.init(flags)
  return {
    ...result,
    model: { ...model, checkout: child.model },
    commands: [
      ...(result.commands ?? []),
      ...(child.commands ?? []).map((command) => Command.mapMessage(command, message))
    ]
  }
}

export function update(
  model: Model,
  childMessage: Checkout.Message
): Update.Return<Model, Message> {
  if (
    model.checkout === null ||
    model.flags.preview ||
    model.page._tag !== 'billing' ||
    purchaseIntent(new URL(model.url).searchParams.get('purchase') ?? undefined) ===
      null
  ) {
    return { model }
  }
  const child = Checkout.update(model.checkout, childMessage)
  return {
    model: { ...model, checkout: child.model },
    commands: (child.commands ?? []).map((command) =>
      Command.mapMessage(command, message)
    )
  }
}
