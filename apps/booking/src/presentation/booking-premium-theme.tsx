import {
  createContext,
  useContext,
  useMemo,
  type CSSProperties,
  type ReactNode
} from 'react'
import { bookingTheme } from './booking-theme.stylex.ts'

export type BookingPremiumPalette = {
  readonly primaryColor: string
  readonly primaryDark: string
  readonly primaryDarker: string
  readonly primaryLight: string
  readonly primaryFontColor: string
  readonly secondaryColor: string
  readonly linkColor: string
}

const paletteKeys = [
  'primaryColor',
  'primaryDark',
  'primaryDarker',
  'primaryLight',
  'primaryFontColor',
  'secondaryColor',
  'linkColor'
] as const

const normalizeColor = (value: unknown) => {
  if (typeof value !== 'string') return null
  const normalized = value.startsWith('0x') ? `#${value.slice(2)}` : value
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toLowerCase() : null
}

export function validateBookingPremiumPalette(
  input: Partial<Record<(typeof paletteKeys)[number], unknown>>
): BookingPremiumPalette | null {
  const values = Object.fromEntries(
    paletteKeys.map((key) => [key, normalizeColor(input[key])])
  ) as Record<(typeof paletteKeys)[number], string | null>
  if (paletteKeys.some((key) => values[key] === null)) return null
  return values as BookingPremiumPalette
}

const customProperty = (reference: string) => {
  const match = /^var\((--[^)]+)\)$/.exec(reference)
  if (!match?.[1]) throw new Error('Invalid Booking theme variable reference')
  return match[1]
}

const premiumStyle = (palette: BookingPremiumPalette) =>
  ({
    [customProperty(bookingTheme.colorPrimary)]: palette.primaryColor,
    [customProperty(bookingTheme.colorPrimaryDark)]: palette.primaryDark,
    [customProperty(bookingTheme.colorPrimaryDarker)]: palette.primaryDarker,
    [customProperty(bookingTheme.colorPrimaryLight)]: palette.primaryLight,
    [customProperty(bookingTheme.colorPrimaryFont)]: palette.primaryFontColor,
    [customProperty(bookingTheme.colorViewOrderBackground)]: palette.primaryColor,
    [customProperty(bookingTheme.colorViewOrderText)]: palette.primaryFontColor,
    [customProperty(bookingTheme.colorCartCloseContent)]: palette.primaryFontColor,
    [customProperty(bookingTheme.colorSecondary)]: palette.secondaryColor,
    [customProperty(bookingTheme.colorLink)]: palette.linkColor
  }) as CSSProperties

const BookingPremiumThemeContext = createContext<CSSProperties | undefined>(undefined)

export function useBookingPremiumTheme() {
  return useContext(BookingPremiumThemeContext)
}

export function BookingPremiumThemeBoundary({
  palette,
  children
}: {
  readonly palette: BookingPremiumPalette | null
  readonly children: ReactNode
}) {
  const value = useMemo(() => (palette ? premiumStyle(palette) : undefined), [palette])

  return (
    <BookingPremiumThemeContext.Provider value={value}>
      {children}
    </BookingPremiumThemeContext.Provider>
  )
}
