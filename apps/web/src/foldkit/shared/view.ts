import { type Html, type HtmlBuilder } from 'foldkit/html'
import { localizeHref } from '@b2b-saas-starter/i18n/runtime'

const buttonBase =
  'ui-pressable inline-flex min-h-11 max-w-full shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium whitespace-normal transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 md:h-9 md:min-h-9 md:py-0 md:whitespace-nowrap'
export const buttonClass = `${buttonBase} border-input bg-input/30 hover:bg-input/50 hover:text-foreground`
export const primaryButtonClass = `${buttonBase} border-transparent bg-primary text-primary-foreground hover:bg-primary/80`
export const secondaryButtonClass = `${buttonBase} border-input bg-secondary text-secondary-foreground hover:bg-secondary/80`
export const textButtonClass = `${buttonBase} border-transparent text-primary underline-offset-4 hover:underline`

export function localeFlag<M>(h: HtmlBuilder<M>, locale: 'en' | 'nb'): Html {
  return h.img([
    h.Src(`/flags/${locale === 'nb' ? 'no' : 'us'}.svg`),
    h.Alt(''),
    h.AriaHidden(true),
    h.Class(
      'pointer-events-none absolute left-3 top-1/2 h-4 w-6 -translate-y-1/2 rounded-sm object-cover'
    )
  ])
}
export const inputClass =
  'h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-ring md:h-9 md:text-sm'

/** Shared field semantics for native forms with one or several validation errors. */
export function textField<M>(
  h: HtmlBuilder<M>,
  options: {
    readonly name: string
    readonly label: string
    readonly value: string
    readonly errors?: ReadonlyArray<string>
    readonly type?: string
    readonly disabled?: boolean
    readonly changed: (value: string) => NoInfer<M>
  }
): Html {
  const error = options.errors?.filter(Boolean).join(', ')
  const errorId = `${options.name}-error`
  return h.div(
    [h.Class('grid min-w-0 gap-2')],
    [
      h.label([h.For(options.name), h.Class('text-sm font-medium')], [options.label]),
      h.input([
        h.Id(options.name),
        h.Name(options.name),
        h.Type(options.type ?? 'text'),
        h.Class(inputClass),
        h.Value(options.value),
        h.Disabled(options.disabled ?? false),
        h.OnInput(options.changed),
        ...(error
          ? [
              h.Attribute('aria-invalid', 'true'),
              h.Attribute('aria-describedby', errorId)
            ]
          : [])
      ]),
      ...(error
        ? [h.p([h.Id(errorId), h.Class('text-sm text-destructive')], [error])]
        : [])
    ]
  )
}

export function link<M>(
  h: HtmlBuilder<M>,
  href: string,
  label: string,
  className = 'inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline'
): Html {
  return h.a(
    [h.Href(href.startsWith('/') ? localizeHref(href) : href), h.Class(className)],
    [label]
  )
}

export function icon<M>(
  h: HtmlBuilder<M>,
  name:
    | 'menu'
    | 'search'
    | 'close'
    | 'chevron'
    | 'copy'
    | 'arrow'
    | 'external'
    | 'check'
    | 'key'
    | 'fingerprint'
    | 'card'
    | 'chart'
    | 'mail'
    | 'shield'
    | 'github'
): Html {
  const paths = {
    menu: 'M4 6h16M4 12h16M4 18h16',
    search: 'm21 21-4.34-4.34M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16',
    close: 'm6 6 12 12M6 18 18 6',
    chevron: 'm6 9 6 6 6-6',
    copy: 'M9 9h12v12H9zM15 9V3H3v12h6',
    arrow: 'M5 12h14m-7-7 7 7-7 7',
    external: 'M7 17 17 7M7 7h10v10',
    check: 'm20 6-11 11-5-5',
    card: 'M2 8h20M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    chart: 'M3 3v18h18M18 17V9M13 17V5M8 17v-3',
    mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm-2 2 10 7L22 6',
    shield: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-4-11 3 3 5-5',
    key: 'm15.5 7.5.01 0M21 7a5 5 0 0 1-7.6 4.3L10 15v3H7v3H3v-4l8.7-8.4A5 5 0 1 1 21 7Z',
    fingerprint:
      'M2 10a10 10 0 0 1 20 0M6 10a6 6 0 0 1 12 0v2a18 18 0 0 1-2 8M10 10a2 2 0 0 1 4 0v2a14 14 0 0 1-3 9M6 14a18 18 0 0 1-1 6M10 14a14 14 0 0 1-2 7M2 14v3M22 14l-1 5',
    github:
      'M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1.01-.02-1.98-3.2.69-3.87-1.54-3.87-1.54-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11.06 11.06 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.07.78 2.16 0 1.56-.01 2.82-.01 3.2 0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z'
  }
  return h.svg(
    [
      h.Attribute('viewBox', '0 0 24 24'),
      h.Attribute('fill', name === 'github' ? 'currentColor' : 'none'),
      h.Attribute('stroke', name === 'github' ? 'none' : 'currentColor'),
      h.Attribute('stroke-width', '2'),
      h.Attribute('stroke-linecap', 'round'),
      h.Attribute('stroke-linejoin', 'round'),
      h.Attribute('aria-hidden', 'true'),
      h.Class('size-4 shrink-0')
    ],
    [h.path([h.Attribute('d', paths[name])])]
  )
}
