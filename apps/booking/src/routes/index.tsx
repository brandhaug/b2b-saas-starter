import * as stylex from '@stylexjs/stylex'
import { createFileRoute, Link } from '@tanstack/react-router'
import { staticPageStyles as styles } from '../components/static-page.styles'

export const Route = createFileRoute('/')({ component: IndexPage })

function IndexPage() {
  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.card)}>
        <p {...stylex.props(styles.eyebrow)}>Migration spike</p>
        <h1 {...stylex.props(styles.title)}>Customer Booking App Flow</h1>
        <p {...stylex.props(styles.copy)}>
          A source-faithful port of the legacy provider-to-confirmation journey into
          TanStack Start and StyleX.
        </p>
        <Link
          to="/$merchantSlug/booking"
          params={{ merchantSlug: 'demo-shop' }}
          search={{ scenario: 'ready' }}
          {...stylex.props(styles.link)}
        >
          Open prototype
        </Link>
      </div>
    </main>
  )
}
