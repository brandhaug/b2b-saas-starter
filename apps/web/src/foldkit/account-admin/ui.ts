import { type Html, type HtmlBuilder } from 'foldkit/html'
import { m } from '@b2b-saas-starter/i18n/messages'
import { buttonClass, inputClass } from '../shared/view'

export function panel<M>(
  h: HtmlBuilder<M>,
  title: string,
  description: string,
  children: ReadonlyArray<Html>
): Html {
  return h.section(
    [h.Class('grid gap-4 border border-border bg-card p-5')],
    [
      ...(title
        ? [
            h.header(
              [h.Class('grid gap-1')],
              [
                h.h2([h.Class('text-lg font-semibold')], [title]),
                ...(description
                  ? [h.p([h.Class('text-sm text-muted-foreground')], [description])]
                  : [])
              ]
            )
          ]
        : []),
      ...children
    ]
  )
}
export function heading<M>(
  h: HtmlBuilder<M>,
  title: string,
  description: string
): Html {
  return h.header(
    [h.Class('grid gap-2')],
    [
      h.h1([h.Class('text-2xl font-semibold')], [title]),
      h.p([h.Class('text-sm text-muted-foreground')], [description])
    ]
  )
}
export function text<M>(h: HtmlBuilder<M>, value: string): Html {
  return h.p([h.Class('text-sm text-muted-foreground')], [value])
}
export function feedback<M>(
  h: HtmlBuilder<M>,
  error: string | null,
  notice: string | null = null
): Html {
  return h.div(
    [h.Class('grid gap-2')],
    [
      ...(error
        ? [h.p([h.Role('alert'), h.Class('text-sm text-destructive')], [error])]
        : []),
      ...(notice ? [h.output([h.Class('text-sm')], [notice])] : [])
    ]
  )
}
export function button<M>(
  h: HtmlBuilder<M>,
  label: string,
  message: M,
  disabled = false,
  ariaLabel = label
): Html {
  return h.button(
    [
      h.Type('button'),
      h.Class(buttonClass),
      h.Disabled(disabled),
      h.AriaLabel(ariaLabel),
      h.OnClick(message)
    ],
    [label]
  )
}
export function field<M>(
  h: HtmlBuilder<M>,
  id: string,
  label: string,
  value: string,
  changed: (value: string) => NoInfer<M>,
  type = 'text',
  required = true,
  placeholder = ''
): Html {
  return h.div(
    [h.Class('grid gap-1.5')],
    [
      h.label([h.For(id), h.Class('text-sm font-medium')], [label]),
      h.input([
        h.Id(id),
        h.Name(id),
        h.Type(type),
        h.Value(value),
        h.Required(required),
        h.Placeholder(placeholder),
        h.Class(inputClass),
        h.Autocomplete(type === 'password' ? 'current-password' : 'off'),
        h.OnInput(changed)
      ])
    ]
  )
}
export function form<M>(
  h: HtmlBuilder<M>,
  message: M,
  label: string,
  pending: boolean,
  ready: boolean,
  fields: ReadonlyArray<Html>
): Html {
  return h.form(
    [
      h.OnSubmit(message),
      h.Attribute('data-hydrated', ready ? 'true' : 'false'),
      h.Class('grid gap-4')
    ],
    [
      h.fieldset(
        [h.Disabled(!ready || pending), h.Class('grid gap-4')],
        [
          ...fields,
          h.button(
            [h.Type('submit'), h.Class(`${buttonClass} w-fit`)],
            [pending ? m.shell_saving() : label]
          )
        ]
      )
    ]
  )
}
export function confirmation<M>(
  h: HtmlBuilder<M>,
  title: string,
  description: string,
  confirm: M,
  cancel: M,
  pending: boolean,
  error: string | null,
  label = title
): Html {
  return h.dialog(
    [
      h.Id('account-admin-confirm'),
      h.Role('alertdialog'),
      h.Attribute('aria-labelledby', 'account-admin-confirm-title'),
      h.Attribute('aria-describedby', 'account-admin-confirm-description'),
      h.Class(
        'm-auto w-[calc(100%-2rem)] max-w-lg border border-border bg-card p-6 text-foreground backdrop:bg-overlay/80'
      )
    ],
    [
      h.h2(
        [h.Id('account-admin-confirm-title'), h.Class('text-lg font-semibold')],
        [title]
      ),
      h.p(
        [
          h.Id('account-admin-confirm-description'),
          h.Class('my-4 text-sm text-muted-foreground')
        ],
        [description]
      ),
      feedback(h, error),
      h.div(
        [h.Class('mt-5 flex flex-wrap justify-end gap-2')],
        [
          button(h, m.common_cancel(), cancel, pending),
          button(h, label, confirm, pending)
        ]
      )
    ]
  )
}
