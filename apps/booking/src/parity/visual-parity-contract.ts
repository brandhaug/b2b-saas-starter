import type { BookingLocale } from '../localization/booking-localization.ts'

export const visualParityProfiles = {
  'mobile-narrow-375x812': {
    host: { width: 375, height: 812 },
    content: { width: 375, height: 812 },
    input: 'touch',
    embedding: 'standalone'
  },
  'mobile-wide-376x812': {
    host: { width: 376, height: 812 },
    content: { width: 375, height: 812 },
    input: 'touch',
    embedding: 'standalone'
  },
  'tablet-widget-768x900-iframe-375x700': {
    host: { width: 768, height: 900 },
    content: { width: 375, height: 700 },
    input: 'touch',
    embedding: 'widget'
  },
  'laptop-1024x768': {
    host: { width: 1024, height: 768 },
    content: { width: 375, height: 768 },
    input: 'mouse-keyboard',
    embedding: 'standalone'
  },
  'desktop-1440x900': {
    host: { width: 1440, height: 900 },
    content: { width: 375, height: 900 },
    input: 'mouse-keyboard',
    embedding: 'standalone'
  },
  'zoom-200': {
    host: { width: 750, height: 812 },
    content: { width: 375, height: 812 },
    input: 'mouse-keyboard',
    embedding: 'standalone',
    zoom: 2
  }
} as const

export type VisualParityProfile = keyof typeof visualParityProfiles

export const visualParityLocales = [
  'en',
  'es',
  'fr',
  'ro'
] as const satisfies readonly BookingLocale[]

export const visualParityMotion = {
  interactionMs: 150,
  pageMs: 300,
  staticPolicy: 'finish-and-freeze',
  choreographyPolicy: 'sample-timeline',
  reducedPolicy: 'reduced'
} as const

export const requiredVisualEvidenceCells = [
  ...visualParityLocales.map((locale) => ({
    locale,
    profile: 'mobile-narrow-375x812' as const
  })),
  { locale: 'en', profile: 'mobile-wide-376x812' },
  { locale: 'ro', profile: 'tablet-widget-768x900-iframe-375x700' },
  { locale: 'en', profile: 'laptop-1024x768' },
  { locale: 'fr', profile: 'desktop-1440x900' },
  { locale: 'en', profile: 'zoom-200' }
] as const satisfies readonly {
  readonly locale: BookingLocale
  readonly profile: VisualParityProfile
}[]
