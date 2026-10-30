/* oxlint-disable unicorn/prefer-dom-node-append -- Cloudflare Element.append has an incompatible HTMLRewriter signature. */
import { Effect, Schema } from 'effect'
import { Command, Runtime } from 'foldkit'
import { afterEach, expect } from 'vite-plus/test'
import { waitFor } from '@testing-library/dom'
import * as Table from '@/foldkit/account-admin/table'
import { type TableView } from '@/lib/table-view'

export const rows = [
  { name: 'Alpha', status: 'open' },
  { name: 'Bravo', status: 'closed' },
  { name: 'Charlie', status: 'open' },
  { name: 'Delta', status: 'closed' },
  { name: 'Echo', status: 'open' }
]
const Row = Schema.Struct({ name: Schema.String, status: Schema.String })
const Model = Schema.Struct({ table: Table.Model, rows: Schema.Array(Row) })
type Message = { _tag: 'Table'; message: Table.Message } | { _tag: 'Refresh' }
function wrap(message: Table.Message): Message {
  return { _tag: 'Table', message }
}
const nameColumn = {
  id: 'name',
  label: 'Name',
  kind: 'text' as const,
  enableHiding: false,
  value: (row: typeof Row.Type) => row.name
}
export const columns: ReadonlyArray<Table.Column<typeof Row.Type, Message>> = [
  nameColumn,
  {
    id: 'status',
    label: 'Status',
    kind: 'select',
    value: (row) => row.status,
    options: [
      { value: 'open', label: 'Open' },
      { value: 'closed', label: 'Closed' }
    ]
  }
]
const disposers: Array<() => void> = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose()
  }
})

/** Production table update, commands and DOM; fixture owns only incoming rows. */
export async function renderTable(
  options: { pageSize?: number; search?: string; view?: TableView } = {}
) {
  window.history.replaceState(null, '', `/${options.search ?? ''}`)
  const mount = document.createElement('div')
  const container = document.createElement('div')
  mount.id = 'shared-table-test'
  container.appendChild(mount)
  document.body.appendChild(container)
  const table = Table.init('members', options.search ?? '', columns)
  const handle = Runtime.embed(
    Runtime.makeApplication({
      Flags: Schema.Null,
      Model,
      init: () => ({
        model: { table: { ...table, view: options.view ?? table.view }, rows }
      }),
      update: (model, message: Message) => {
        if (message._tag === 'Refresh') {
          return {
            model: {
              ...model,
              rows: [
                ...rows,
                ...['Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo'].map(
                  (name) => ({ name, status: 'open' })
                )
              ]
            }
          }
        }
        const next = Table.update(model.table, message.message)
        return {
          model: { ...model, table: next.model },
          commands: (next.commands ?? []).map((command) =>
            Command.mapMessage(command, wrap)
          )
        }
      },
      view: (model, h) => ({
        title: 'Table',
        body: h.main(
          [],
          [
            Table.view(
              model.table,
              h,
              wrap,
              model.rows,
              columns,
              'Modules',
              'No matches',
              options.pageSize
            ),
            h.button([h.OnClick({ _tag: 'Refresh' })], ['Refresh rows'])
          ]
        )
      }),
      container: mount
    }),
    { flags: Effect.succeed(null) }
  )
  disposers.push(() => {
    handle.dispose()
    container.remove()
  })
  await waitFor(() => expect(container.querySelector('table')).not.toBeNull())
  return { mount: container }
}
