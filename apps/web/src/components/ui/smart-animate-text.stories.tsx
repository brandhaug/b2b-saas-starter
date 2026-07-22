import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { SmartAnimateText } from '@/components/ui/smart-animate-text'

const weekdays = ['mon.', 'tue.', 'wed.', 'thu.', 'fri.', 'sat.', 'sun.'] as const

function SmartAnimateTextDemo() {
  const [amount, setAmount] = useState(0)
  const [weekday, setWeekday] = useState<(typeof weekdays)[number]>(weekdays[0])

  return (
    <div className="flex min-w-96 flex-col items-center gap-12 p-10">
      <div className="flex flex-col items-center gap-5">
        <SmartAnimateText
          value={`$${amount.toFixed(2)}`}
          className="text-6xl font-bold tabular-nums"
        />
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" onClick={() => setAmount(0)}>
            $0.00
          </Button>
          {[10, 25, 100].map((increment) => (
            <Button
              key={increment}
              variant="outline"
              onClick={() => setAmount((current) => current + increment)}
            >
              +{increment}
            </Button>
          ))}
          <Button onClick={() => setAmount(Math.floor(Math.random() * 1000))}>
            Random
          </Button>
        </div>
      </div>

      <div className="flex flex-col items-center gap-5">
        <SmartAnimateText value={weekday} className="text-5xl font-bold" />
        <div className="flex flex-wrap justify-center gap-2">
          {weekdays.map((day) => (
            <Button
              key={day}
              variant={day === weekday ? 'default' : 'outline'}
              onClick={() => setWeekday(day)}
            >
              {day}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

const meta = {
  title: 'UI/Smart Animate Text',
  component: SmartAnimateText,
  parameters: { layout: 'centered' }
} satisfies Meta<typeof SmartAnimateText>

export default meta
type Story = StoryObj<typeof meta>

export const Interactive: Story = {
  args: { value: 'mon.' },
  render: () => <SmartAnimateTextDemo />
}
