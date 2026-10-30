import { Effect, Queue, Schema, Stream } from 'effect'
import { Command, Render, Subscription, type Update } from 'foldkit'
import { type Html, type HtmlBuilder } from 'foldkit/html'
import { m } from '@b2b-saas-starter/i18n/messages'
import { DOC_CATEGORY_ORDER } from '@/lib/doc-categories'
import { searchDocs } from '@/lib/docs-search'
import { Flags, type DocMeta, categoryName, docPath } from './contracts'
import { buttonClass, inputClass, link, icon } from '../shared/view'
import { architecture } from '../public/architecture'

export { Flags }
export const Model = Schema.Struct({
  flags: Flags,
  draft: Schema.String,
  activeIds: Schema.Array(Schema.String),
  ready: Schema.Boolean
})
export type Model = typeof Model.Type
export const Message = Schema.TaggedUnion({
  Ready: {},
  ChangedQuery: { query: Schema.String },
  Searched: {},
  HeadingsChanged: { ids: Schema.Array(Schema.String) },
  Jumped: { id: Schema.String },
  Completed: {}
})
export type Message = typeof Message.Type
const Ready = Command.define('Docs.Ready', {
  messages: [Message.cases.Ready],
  execute: Effect.succeed(Message.cases.Ready.make({}))
})
const Search = Command.define('Docs.Search', {
  args: { query: Schema.String },
  messages: [Message.cases.Completed],
  execute: ({ query }) =>
    Effect.sync(() => {
      const url = new URL(window.location.href)
      url.searchParams.set('q', query)
      window.location.assign(url)
      return Message.cases.Completed.make({})
    })
})
const Jump = Command.define('Docs.Jump', {
  args: { id: Schema.String },
  messages: [Message.cases.Completed],
  execute: ({ id }) =>
    Effect.sync(() => {
      const target = document.getElementById(id)
      target?.scrollIntoView({ behavior: 'instant' })
      history.replaceState(null, '', `#${encodeURIComponent(id)}`)
      if (target) {
        target.tabIndex = -1
        target.focus({ preventScroll: true })
      }
      return Message.cases.Completed.make({})
    })
})
export function init(flags: typeof Flags.Type): Update.Return<Model, Message> {
  return {
    model: {
      flags,
      draft: flags._tag === 'Search' ? flags.query : '',
      activeIds: [],
      ready: false
    },
    commands: [Ready()]
  }
}
export function update(model: Model, message: Message): Update.Return<Model, Message> {
  switch (message._tag) {
    case 'Ready': {
      return { model: { ...model, ready: true } }
    }
    case 'ChangedQuery': {
      return { model: { ...model, draft: message.query.slice(0, 200) } }
    }
    case 'Searched': {
      return { model, commands: [Search({ query: model.draft.trim() })] }
    }
    case 'HeadingsChanged': {
      return { model: { ...model, activeIds: message.ids } }
    }
    case 'Jumped': {
      return { model, commands: [Jump({ id: message.id })] }
    }
    case 'Completed': {
      return { model }
    }
  }
}
export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  headings: entry(
    { active: Schema.Boolean },
    {
      modelToDependencies: (model) => ({
        active: model.ready && model.flags._tag === 'Article'
      }),
      dependenciesToStream: ({ active }) =>
        active
          ? Stream.callback<Message>((queue) =>
              Effect.gen(function* () {
                yield* Render.afterCommit
                const visible = new Set<string>()
                const observer = new IntersectionObserver((entries) => {
                  for (const observed of entries) {
                    if (observed.isIntersecting) {
                      visible.add(observed.target.id)
                    } else {
                      visible.delete(observed.target.id)
                    }
                  }
                  Queue.offerUnsafe(
                    queue,
                    Message.cases.HeadingsChanged.make({ ids: [...visible] })
                  )
                })
                for (const heading of document.querySelectorAll(
                  '#docs-article h2[id], #docs-article h3[id]'
                )) {
                  observer.observe(heading)
                }
                yield* Effect.addFinalizer(() =>
                  Effect.sync(() => observer.disconnect())
                )
              })
            )
          : Stream.empty
    }
  )
}))
type H = HtmlBuilder<Message>
function toc(model: Model, h: H): Html {
  if (model.flags._tag !== 'Article' || model.flags.headings.length === 0) {
    return h.div([])
  }
  const active = new Set(model.activeIds)
  const items = model.flags.headings.map((heading) =>
    h.li(
      [],
      [
        h.a(
          [
            h.Href(`#${heading.id}`),
            h.Class(
              `block border-l-2 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${heading.level === 3 ? 'pl-5' : 'pl-3'} ${active.has(heading.id) ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`
            ),
            ...(active.has(heading.id)
              ? [h.Attribute('aria-current', 'location')]
              : []),
            h.OnClick(Message.cases.Jumped.make({ id: heading.id }), {
              defaultAction: 'Prevent'
            })
          ],
          [heading.text]
        )
      ]
    )
  )
  return h.nav(
    [h.AriaLabel(m.public_knowledge_on_page()), h.Class('sticky top-18')],
    [
      h.p(
        [h.Class('mb-3 text-xs font-medium text-foreground')],
        [m.public_knowledge_on_page()]
      ),
      h.ul([h.Class('flex flex-col gap-1')], items)
    ]
  )
}
function searchView(model: Model, h: H): Html {
  if (model.flags._tag !== 'Search') {
    return h.div([])
  }
  const results = searchDocs(model.flags.articles, model.flags.query)
  let status = m.docs_search_count({ count: results.length })
  if (results.length === 0) {
    status = m.docs_search_no_results()
  }
  if (model.flags.query.trim() === '') {
    status = m.docs_search_hint()
  }
  return h.section(
    [h.Class('mx-auto flex max-w-3xl flex-col gap-6')],
    [
      h.div(
        [h.Class('flex flex-col gap-2')],
        [
          h.h1([h.Class('text-3xl font-semibold')], [m.docs_search_title()]),
          h.p([h.Class('text-sm text-muted-foreground')], [m.docs_search_language()])
        ]
      ),
      h.search(
        [],
        [
          h.form(
            [
              h.Class('flex items-end gap-3'),
              h.OnSubmit(Message.cases.Searched.make({}))
            ],
            [
              h.div(
                [h.Class('min-w-0 flex-1')],
                [
                  h.label([h.For('docs-search-query')], [m.docs_search_label()]),
                  h.input([
                    h.Id('docs-search-query'),
                    h.Type('search'),
                    h.Class(inputClass),
                    h.Attribute('maxlength', '200'),
                    h.Value(model.draft),
                    h.OnInput((query) => Message.cases.ChangedQuery.make({ query }))
                  ])
                ]
              ),
              h.button([h.Type('submit'), h.Class(buttonClass)], [m.common_search()])
            ]
          )
        ]
      ),
      h.output([h.Class('text-sm text-muted-foreground')], [status]),
      results.length
        ? h.ul(
            [
              h.AriaLabel(m.docs_search_results()),
              h.Class('flex flex-col divide-y divide-border')
            ],
            results.map(({ article, excerpt }) =>
              h.li(
                [h.Class('flex flex-col gap-2 py-5 first:pt-0')],
                [
                  link(
                    h,
                    article.route,
                    article.title,
                    'flex min-h-11 w-fit items-center text-lg font-semibold text-primary underline-offset-4 hover:underline md:min-h-0'
                  ),
                  h.p(
                    [h.Class('text-sm wrap-anywhere text-muted-foreground')],
                    [excerpt]
                  ),
                  link(
                    h,
                    article.source,
                    m.docs_search_source(),
                    'flex min-h-11 w-fit items-center py-2 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground md:min-h-0'
                  )
                ]
              )
            )
          )
        : null
    ]
  )
}
function articleView(model: Model, h: H): Html {
  if (model.flags._tag !== 'Article') {
    return searchView(model, h)
  }
  const { meta, html, jsonLd, prev, next } = model.flags
  return h.div(
    [],
    [
      h.script([
        h.Type('application/ld+json'),
        h.InnerHTML(jsonLd.replaceAll('<', String.raw`\u003c`))
      ]),
      h.div(
        [h.Class('flex gap-8')],
        [
          h.div(
            [h.Class('min-w-0 flex-1')],
            [
              h.nav(
                [
                  h.AriaLabel(m.public_knowledge_breadcrumb()),
                  h.Class('mb-6 text-xs text-muted-foreground')
                ],
                [
                  h.ol(
                    [h.Class('flex flex-wrap items-center gap-1')],
                    [
                      h.li(
                        [],
                        [
                          link(
                            h,
                            '/docs',
                            m.public_docs_title(),
                            'hover:text-foreground'
                          )
                        ]
                      ),
                      h.li([h.Attribute('aria-hidden', 'true')], ['/']),
                      h.li([], [categoryName(meta.category)]),
                      h.li([h.Attribute('aria-hidden', 'true')], ['/']),
                      h.li(
                        [
                          h.Attribute('aria-current', 'page'),
                          h.Class('text-foreground')
                        ],
                        [meta.frontmatter.title]
                      )
                    ]
                  )
                ]
              ),
              h.header(
                [h.Class('mb-8')],
                [
                  h.h1(
                    [h.Class('mb-2 text-3xl font-semibold')],
                    [meta.frontmatter.title]
                  ),
                  h.p(
                    [h.Class('text-sm text-muted-foreground')],
                    [meta.frontmatter.description]
                  ),
                  h.div(
                    [h.Class('mt-3 flex flex-wrap gap-2')],
                    (meta.frontmatter.tags ?? []).map((tag) =>
                      h.span(
                        [
                          h.Class(
                            'rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                          )
                        ],
                        [tag]
                      )
                    )
                  )
                ]
              ),
              h.details(
                [h.Class('mb-6 border border-border lg:hidden')],
                [
                  h.summary(
                    [
                      h.Class(
                        'cursor-pointer px-3 py-2 text-sm font-medium select-none'
                      )
                    ],
                    [m.public_knowledge_on_page()]
                  ),
                  h.div([h.Class('px-3 pt-1 pb-3')], [toc(model, h)])
                ]
              ),
              // Only the build-owned Markdown compiler may supply html. Never render request or user content here.
              h.article(
                [
                  h.Id('docs-article'),
                  h.Attribute('lang', 'en'),
                  h.Class(
                    'prose prose-lg max-w-3xl prose-h2:text-xl prose-h3:text-base'
                  )
                ],
                html
                  .split('<!--starter-architecture-->')
                  .flatMap((part, index) =>
                    index === 0
                      ? [h.div([h.InnerHTML(part)])]
                      : [architecture(h), h.div([h.InnerHTML(part)])]
                  )
              ),
              h.nav(
                [
                  h.AriaLabel(m.public_knowledge_adjacent()),
                  h.Class(
                    'mt-12 flex items-center justify-between gap-4 border-t border-border pt-4'
                  )
                ],
                [
                  prev
                    ? link(
                        h,
                        docPath(prev),
                        prev.frontmatter.title,
                        'inline-flex items-center gap-1 py-2 text-sm text-muted-foreground hover:text-foreground'
                      )
                    : h.span([]),
                  next
                    ? h.a(
                        [
                          h.Href(docPath(next)),
                          h.Class(
                            'inline-flex items-center gap-1 py-2 text-sm text-muted-foreground hover:text-foreground'
                          )
                        ],
                        [next.frontmatter.title, icon(h, 'arrow')]
                      )
                    : h.span([])
                ]
              )
            ]
          ),
          h.aside([h.Class('hidden w-48 shrink-0 lg:block')], [toc(model, h)])
        ]
      )
    ]
  )
}
export function view(
  model: Model,
  h: H,
  docs: ReadonlyArray<DocMeta>,
  path: string
): Html {
  function sectionLinks(): Html {
    return h.ul(
      [h.Class('flex flex-col gap-0.5')],
      DOC_CATEGORY_ORDER.map((category) => {
        const articles = docs.filter((doc) => doc.category === category)
        return articles.length
          ? h.li(
              [h.Class('mt-2 first:mt-0')],
              [
                h.p(
                  [h.Class('px-2 pb-1 text-sm font-semibold text-foreground')],
                  [categoryName(category)]
                ),
                h.ul(
                  [h.Class('flex flex-col gap-0.5')],
                  articles.map((doc) =>
                    h.li(
                      [],
                      [
                        h.a(
                          [
                            h.Href(docPath(doc)),
                            ...(docPath(doc) === path
                              ? [h.Attribute('aria-current', 'page')]
                              : []),
                            h.Class(
                              `block rounded-md px-2 py-2 text-xs ${docPath(doc) === path ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`
                            )
                          ],
                          [doc.frontmatter.title]
                        )
                      ]
                    )
                  )
                )
              ]
            )
          : null
      })
    )
  }
  return h.div(
    [
      h.Class(
        'mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 md:flex-row'
      )
    ],
    [
      link(
        h,
        '/docs/search?q=',
        m.docs_search_title(),
        'flex min-h-11 items-center py-2 text-sm text-primary underline underline-offset-4 md:hidden'
      ),
      h.details(
        [h.Class('group w-full border border-border md:hidden')],
        [
          h.summary(
            [h.Class('cursor-pointer px-3 py-2 text-sm font-medium')],
            [m.public_knowledge_sections()]
          ),
          h.nav(
            [h.AriaLabel(m.public_knowledge_nav()), h.Class('px-3 pb-3')],
            [sectionLinks()]
          )
        ]
      ),
      h.aside(
        [h.Class('hidden w-60 shrink-0 md:block')],
        [
          h.div(
            [h.Class('sticky top-18 flex max-h-below-header flex-col gap-4')],
            [
              link(
                h,
                '/docs/search?q=',
                m.docs_search_title(),
                'p-2 text-sm text-primary underline underline-offset-4'
              ),
              h.nav(
                [
                  h.AriaLabel(m.public_knowledge_nav()),
                  h.Class('flex-1 overflow-y-auto pr-1 pb-4')
                ],
                [sectionLinks()]
              )
            ]
          )
        ]
      ),
      h.main(
        [h.Id('main-content'), h.Tabindex(-1), h.Class('min-w-0 flex-1 outline-none')],
        [articleView(model, h)]
      )
    ]
  )
}
