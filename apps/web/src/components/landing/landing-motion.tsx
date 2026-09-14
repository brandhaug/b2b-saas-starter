import { useRef, type RefObject } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(useGSAP, ScrollTrigger)

export default function LandingMotion({
  root,
  paused
}: {
  readonly root: RefObject<HTMLElement | null>
  readonly paused: boolean
}) {
  const marqueeRef = useRef<gsap.core.Tween | null>(null)
  const pausedRef = useRef(paused)
  useGSAP(
    () => {
      const media = gsap.matchMedia()
      media.add('(prefers-reduced-motion: no-preference)', () => {
        marqueeRef.current = gsap.to('[data-marquee]', {
          xPercent: -50,
          duration: 32,
          ease: 'none',
          repeat: -1,
          paused: pausedRef.current
        })
        const cards = gsap.utils.toArray<HTMLElement>('[data-stack-card]')
        const stack = root.current?.querySelector('[data-decision-stack]')
        if (stack) {
          cards.slice(0, -1).forEach((card, index) => {
            ScrollTrigger.create({
              trigger: card,
              start: 'top 128px',
              endTrigger: stack,
              end: 'bottom 450px',
              pin: true,
              pinSpacing: false
            })
            const next = cards[index + 1]
            if (next) {
              gsap.to(card, {
                scale: 0.94,
                transformOrigin: 'center top',
                scrollTrigger: {
                  trigger: next,
                  start: () => `top ${128 + card.offsetHeight}px`,
                  end: 'top 128px',
                  scrub: true,
                  onUpdate: (self) => {
                    card.inert = self.progress >= 1
                  }
                }
              })
            }
          })
        }
        gsap.utils.toArray<HTMLElement>('[data-scale-image]').forEach((image) => {
          const timeline = gsap.timeline({
            scrollTrigger: {
              trigger: image,
              start: 'top 95%',
              end: 'bottom 10%',
              scrub: true
            }
          })
          timeline
            .fromTo(image, { scale: 0.8, opacity: 1 }, { scale: 1, opacity: 1 })
            .to(image, { opacity: 0.2 })
        })
        return () => {
          cards.forEach((card) => {
            card.inert = false
          })
        }
      })
      return () => {
        media.revert()
        marqueeRef.current = null
      }
    },
    { scope: root }
  )
  useGSAP(
    () => {
      pausedRef.current = paused
      marqueeRef.current?.paused(paused)
    },
    { scope: root, dependencies: [paused] }
  )
  return null
}
