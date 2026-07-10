import * as stylex from '@stylexjs/stylex'
import { Link } from '@tanstack/react-router'
import { staticPageStyles as styles } from './static-page.styles'

export function NotFoundPage() {
  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.card, styles.narrow)}>
        <p {...stylex.props(styles.eyebrow, styles.mono)}>404</p>
        <h1 {...stylex.props(styles.title, styles.narrowTitle)}>
          Booking page not found
        </h1>
        <p {...stylex.props(styles.copy)}>
          This migration spike only exposes the seeded SQUIRE Demo booking flow.
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
