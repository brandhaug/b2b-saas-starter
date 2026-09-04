import { useEffect, useState } from 'react'

/**
 * How long the resend control stays disabled after a code goes out. The
 * plugin's own send rate limit is three per minute, so sixty seconds is the
 * natural visible cooldown — the button re-enables about when the server
 * would allow the resend anyway.
 */
export const RESEND_COOLDOWN_SECONDS = 60

/**
 * The visible resend cooldown: `remaining` counts down to 0 once `start` has
 * run. The tick is one interval set up while the countdown runs and torn down
 * when it ends or the component unmounts — no interval keeps firing at 0.
 */
export function useResendCooldown(seconds: number = RESEND_COOLDOWN_SECONDS) {
  const [remaining, setRemaining] = useState(0)
  const active = remaining > 0

  useEffect(() => {
    if (!active) {
      return
    }
    // One interval for the whole countdown: the tick reads `remaining`
    // functionally, so the effect never has to tear down and rebuild per
    // second.
    const timer = window.setInterval(() => {
      setRemaining((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [active])

  return {
    remaining,
    start: () => {
      setRemaining(seconds)
    }
  }
}
