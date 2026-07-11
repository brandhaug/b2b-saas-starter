import { createFileRoute } from '@tanstack/react-router'

// The Worker intercepts Booking ingress and redirects into a capability-protected
// Booking Session before TanStack renders. This route exists only for navigation typing.
export const Route = createFileRoute('/$merchantSlug/booking')({
  component: () => null
})
