import { type Html, type HtmlBuilder } from 'foldkit/html'
import { Option } from 'effect'
import { m } from '@b2b-saas-starter/i18n/messages'
import { buttonClass, inputClass, link } from '../shared/view'
import { type Model, type Message, type Action } from './model'
export { link }
export type H = HtmlBuilder<Message>
export const popoverClass =
  'fixed inset-auto left-1/2 top-24 z-50 m-0 hidden [&:popover-open]:grid max-h-[calc(100dvh-7rem)] w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 gap-3 overflow-y-auto rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-lg'

export function actionMenu(
  h: H,
  id: string,
  label: string,
  items: ReadonlyArray<{ label: string; message: Message; disabled: boolean }>
): Html {
  const enabled = items.flatMap((item, index) => (item.disabled ? [] : [index]))
  return h.div(
    [],
    [
      h.button(
        [
          h.Type('button'),
          h.Class(buttonClass),
          h.Attribute('popovertarget', id),
          h.Attribute('aria-haspopup', 'menu')
        ],
        [label]
      ),
      h.div(
        [
          h.Id(id),
          h.Role('menu'),
          h.Attribute('aria-label', label),
          h.Attribute('popover', 'auto'),
          h.Class(popoverClass)
        ],
        items.map((item, index) =>
          h.button(
            [
              h.Id(`${id}-${index}`),
              h.Type('button'),
              h.Role('menuitem'),
              h.Class(buttonClass),
              h.Disabled(item.disabled),
              ...(index === enabled[0] ? [h.Attribute('autofocus', '')] : []),
              h.Attribute('popovertarget', id),
              h.Attribute('popovertargetaction', 'hide'),
              h.OnClick(item.message),
              h.OnKeyDownFocus((key) => {
                let next: number | undefined
                const position = enabled.indexOf(index)
                if (key === 'ArrowDown') {
                  next = enabled[(position + 1) % enabled.length]
                } else if (key === 'ArrowUp') {
                  next = enabled[(position + enabled.length - 1) % enabled.length]
                } else if (key === 'Home') {
                  next = enabled[0]
                } else if (key === 'End') {
                  next = enabled.at(-1)
                }
                return next === undefined
                  ? Option.none()
                  : Option.some({
                      focusSelector: `#${id}-${next}`,
                      message: { _tag: 'Noop' }
                    })
              })
            ],
            [item.label]
          )
        )
      )
    ]
  )
}
export function empty(h: H) {
  return h.span([], [])
}
export function button(
  h: H,
  label: string,
  message: Message,
  disabled = false,
  primary = false
) {
  return h.button(
    [
      h.Type('button'),
      h.Class(
        `${buttonClass} ${primary ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''}`
      ),
      h.Disabled(disabled),
      h.OnClick(message)
    ],
    [label]
  )
}
export function action(
  h: H,
  model: Model,
  label: string,
  value: Action,
  confirm = false
) {
  return button(
    h,
    label,
    confirm
      ? { _tag: 'Confirm', action: value, title: label }
      : { _tag: 'Perform', action: value },
    model.pending
  )
}
export function field(
  h: H,
  id: string,
  label: string,
  value: string,
  changed: (value: string) => Message,
  type = 'text',
  disabled = false,
  placeholder = ''
) {
  return h.div(
    [h.Class('grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2')],
    [
      h.label([h.For(id), h.Class('text-sm font-medium')], [label]),
      h.input([
        h.Id(id),
        h.Type(type),
        h.Class(`${inputClass} min-w-0`),
        h.Value(value),
        h.Placeholder(placeholder),
        h.Disabled(disabled),
        h.OnInput(changed)
      ])
    ]
  )
}
export function textarea(
  h: H,
  id: string,
  label: string,
  value: string,
  changed: (value: string) => Message,
  disabled = false,
  placeholder = ''
) {
  return h.div(
    [h.Class('grid gap-2')],
    [
      h.label([h.For(id)], [label]),
      h.textarea([
        h.Id(id),
        h.Class(`${inputClass} h-auto min-h-24`),
        h.Value(value),
        h.Disabled(disabled),
        h.Placeholder(placeholder),
        h.Attribute('rows', '4'),
        h.OnInput(changed)
      ])
    ]
  )
}
export function select(
  h: H,
  label: string,
  value: string,
  options: ReadonlyArray<readonly [string, string]>,
  changed: (value: string) => Message
) {
  return h.label(
    [h.Class('grid gap-2 text-sm')],
    [
      label,
      h.select(
        [h.Class(inputClass), h.Value(value), h.OnChange(changed)],
        options.map(([id, text]) => h.option([h.Value(id)], [text]))
      )
    ]
  )
}
export function checkbox(
  h: H,
  label: string,
  checked: boolean,
  message: Message,
  disabled = false
) {
  return h.label(
    [h.Class('flex min-h-11 items-center gap-3 text-sm')],
    [
      h.input([
        h.Type('checkbox'),
        h.Checked(checked),
        h.Attribute('aria-checked', String(checked)),
        h.Attribute('aria-disabled', String(disabled)),
        h.Disabled(disabled),
        h.OnChange(() => message),
        h.Class('size-4 accent-primary')
      ]),
      label
    ]
  )
}
export function panel(h: H, title: string, children: ReadonlyArray<Html>) {
  return h.section(
    [h.Class('grid min-w-0 gap-4 border border-border bg-card p-6')],
    [h.h2([h.Class('text-lg font-semibold')], [title]), ...children]
  )
}
export function heading(
  h: H,
  title: string,
  description: string,
  actions: ReadonlyArray<Html> = []
) {
  return h.header(
    [h.Class('flex flex-wrap items-start justify-between gap-4')],
    [
      h.div(
        [h.Class('grid gap-2')],
        [
          h.h1([h.Class('text-2xl font-semibold')], [title]),
          h.p([h.Class('text-sm text-muted-foreground')], [description])
        ]
      ),
      ...actions
    ]
  )
}
export function feedback(h: H, model: Model) {
  return h.div(
    [h.Attribute('aria-live', 'polite'), h.Class('grid gap-2')],
    [
      ...(model.error
        ? [h.p([h.Role('alert'), h.Class('text-sm text-destructive')], [model.error])]
        : []),
      ...(model.notice
        ? [h.p([h.Role('status'), h.Class('text-sm text-status-ok')], [model.notice])]
        : [])
    ]
  )
}
export function secret(h: H, model: Model) {
  let label = model.tokens.replacement ? m.form_replacement_token() : m.form_api_token()
  let notice = model.tokens.replacement
    ? m.replacement_copy_notice()
    : m.token_created_copy_now()
  if (model.page._tag === 'webhooks') {
    label = m.webhook_secret()
    notice = m.webhook_created_copy_notice()
  }
  return model.secret === null
    ? empty(h)
    : panel(h, notice, [
        button(
          h,
          model.secretVisible
            ? m.action_hide_named({ label })
            : m.action_show_named({ label }),
          { _tag: 'ToggleSecret' }
        ),
        ...(model.secretVisible
          ? [h.code([h.Class('break-all select-all')], [model.secret])]
          : [h.code([], [`${model.secret.slice(0, 3)}…${model.secret.slice(-4)}`])]),
        button(h, m.action_copy_named({ label }), {
          _tag: 'Copy',
          text: model.secret,
          secret: true
        }),
        h.p([], [m.token_store_secret()])
      ])
}
export function query(model: Model, key: string) {
  return new URL(model.url).searchParams.get(key) ?? ''
}
export function href(model: Model, suffix = '') {
  return `${model.flags.preview ? '/demo' : `/workspaces/${encodeURIComponent(model.flags.slug)}`}${suffix}`
}
export function tabs(
  h: H,
  model: Model,
  options: ReadonlyArray<readonly [string, string]>
) {
  const selected = query(model, 'tab') || options[0]?.[0]
  return h.div(
    [h.Role('tablist'), h.Class('flex flex-wrap gap-2 border-b border-border pb-3')],
    options.map(([value, label], index) =>
      h.button(
        [
          h.Type('button'),
          h.Role('tab'),
          h.Id(`workspace-tab-${value}`),
          h.Attribute('aria-controls', `workspace-panel-${value}`),
          h.Attribute('tabindex', selected === value ? '0' : '-1'),
          h.Attribute('aria-selected', String(selected === value)),
          h.Class(`${buttonClass} ${selected === value ? 'bg-accent' : ''}`),
          h.OnClick({ _tag: 'Query', key: 'tab', value, replace: false }),
          h.OnKeyDownFocus((key) => {
            let target: (typeof options)[number] | undefined
            if (key === 'Home') {
              target = options[0]
            } else if (key === 'End') {
              target = options.at(-1)
            } else if (key === 'ArrowRight' || key === 'ArrowLeft') {
              const offset = key === 'ArrowRight' ? 1 : -1
              target = options[(index + offset + options.length) % options.length]
            }
            return target
              ? Option.some({
                  focusSelector: `#workspace-tab-${target[0]}`,
                  message: {
                    _tag: 'Query',
                    key: 'tab',
                    value: target[0],
                    replace: false
                  }
                })
              : Option.none()
          })
        ],
        [label]
      )
    )
  )
}
export function tabPanel(h: H, value: string, children: ReadonlyArray<Html>) {
  return h.div(
    [
      h.Id(`workspace-panel-${value}`),
      h.Role('tabpanel'),
      h.Attribute('aria-labelledby', `workspace-tab-${value}`),
      h.Attribute('tabindex', '0'),
      h.Class('grid gap-6')
    ],
    children
  )
}
export function row(
  h: H,
  title: string,
  description: string,
  actions: ReadonlyArray<Html>
) {
  return h.li(
    [
      h.Attribute('data-slot', 'item'),
      h.Class('flex flex-wrap items-center gap-4 border-b border-border py-4')
    ],
    [
      h.div(
        [h.Class('min-w-0 flex-1')],
        [
          h.p([h.Class('font-medium break-words')], [title]),
          h.p([h.Class('text-sm text-muted-foreground break-all')], [description])
        ]
      ),
      ...actions
    ]
  )
}
