import * as stylex from '@stylexjs/stylex'
import { createFileRoute } from '@tanstack/react-router'
import { staticPageStyles as styles } from '../components/static-page.styles'

export const Route = createFileRoute('/')({ component: IndexPage })

function IndexPage() {
  return (
    <main {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.card)}>
        <p {...stylex.props(styles.eyebrow)}>Booking App</p>
        <h1 {...stylex.props(styles.title)}>Customer booking</h1>
        <p {...stylex.props(styles.copy)}>
          Open a merchant's public booking page to choose a service and time.
        </p>
      </div>
    </main>
  )
}
