import { Check, Circle, Minus, X } from 'lucide-react'

export const appointmentRowStatus = {
  scheduled: { icon: Circle, label: 'Scheduled', className: 'text-info' },
  completed: { icon: Check, label: 'Completed', className: 'text-muted-foreground' },
  cancelled: { icon: X, label: 'Cancelled', className: 'text-destructive' },
  no_show: { icon: Minus, label: 'No show', className: 'text-destructive' }
} as const
