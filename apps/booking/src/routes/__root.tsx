import '@fontsource-variable/geist/index.css'
import '@fontsource-variable/geist-mono/index.css'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import { NotFoundPage } from '../components/not-found-page'
import appCss from '../index.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Booking App Flow — migration spike' },
      {
        name: 'description',
        content: 'Source-faithful migration spike for the customer booking flow.'
      }
    ],
    links: [{ rel: 'stylesheet', href: appCss }]
  }),
  component: RootComponent,
  notFoundComponent: NotFoundPage
})

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {import.meta.env.DEV ? (
          <>
            <link rel="stylesheet" href="/_booking/virtual:stylex.css" />
            <script type="module" src="/_booking/@id/virtual:stylex:runtime" />
          </>
        ) : null}
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
}
