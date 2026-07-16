import { Schema } from 'effect'

export const CatalogLocale = Schema.Literals(['en', 'es', 'fr', 'ro'])
export type CatalogLocale = typeof CatalogLocale.Type

export const BookingPremiumPalette = Schema.Struct({
  primaryColor: Schema.String,
  primaryDark: Schema.String,
  primaryDarker: Schema.String,
  primaryLight: Schema.String,
  primaryFontColor: Schema.String,
  secondaryColor: Schema.String,
  linkColor: Schema.String
})
export type BookingPremiumPalette = typeof BookingPremiumPalette.Type

const OptionalCatalogTranslations = Schema.Struct({
  en: Schema.optional(Schema.String),
  es: Schema.optional(Schema.String),
  fr: Schema.optional(Schema.String),
  ro: Schema.optional(Schema.String)
})

const PartialBookingPremiumPalette = Schema.Struct({
  primaryColor: Schema.optional(Schema.String),
  primaryDark: Schema.optional(Schema.String),
  primaryDarker: Schema.optional(Schema.String),
  primaryLight: Schema.optional(Schema.String),
  primaryFontColor: Schema.optional(Schema.String),
  secondaryColor: Schema.optional(Schema.String),
  linkColor: Schema.optional(Schema.String)
})

export const BookingConfiguration = Schema.Struct({
  sourceLocale: Schema.optional(CatalogLocale),
  nameTranslations: Schema.optional(OptionalCatalogTranslations),
  descriptionTranslations: Schema.optional(OptionalCatalogTranslations),
  shortName: Schema.optional(Schema.String),
  shortNameTranslations: Schema.optional(OptionalCatalogTranslations),
  adultsOnly: Schema.optional(Schema.Boolean),
  premiumPalette: Schema.optional(Schema.NullOr(PartialBookingPremiumPalette))
})
export type BookingConfiguration = typeof BookingConfiguration.Type

export function decodeBookingConfiguration(
  value: unknown
): BookingConfiguration | null {
  try {
    return Schema.decodeUnknownSync(BookingConfiguration)(value)
  } catch {
    return null
  }
}

export const ResolvedCatalogText = Schema.Struct({
  text: Schema.String,
  locale: CatalogLocale,
  isSourceLanguageFallback: Schema.Boolean
})
export type ResolvedCatalogText = typeof ResolvedCatalogText.Type

export const ResolvedBookingConfiguration = Schema.Struct({
  merchantName: ResolvedCatalogText,
  brandName: ResolvedCatalogText,
  shopName: ResolvedCatalogText,
  adultsOnly: Schema.Boolean,
  premiumPalette: Schema.NullOr(BookingPremiumPalette),
  premiumPaletteSource: Schema.NullOr(Schema.Literals(['merchant', 'brand', 'shop']))
})
export type ResolvedBookingConfiguration = typeof ResolvedBookingConfiguration.Type

const paletteKeys = [
  'primaryColor',
  'primaryDark',
  'primaryDarker',
  'primaryLight',
  'primaryFontColor',
  'secondaryColor',
  'linkColor'
] as const satisfies readonly (keyof BookingPremiumPalette)[]

const controlledColor = /^#[0-9a-f]{6}$/i

export function validateBookingPalette(
  value:
    | Partial<Record<keyof BookingPremiumPalette, string | undefined>>
    | null
    | undefined
): BookingPremiumPalette | null {
  if (!value) return null
  const entries = paletteKeys.map((key) => [key, value[key]] as const)
  if (
    entries.some(
      ([, color]) =>
        typeof color !== 'string' ||
        !controlledColor.test(color) ||
        color.length > 32 ||
        color.includes(';')
    )
  ) {
    return null
  }
  return Object.fromEntries(entries) as BookingPremiumPalette
}

export function resolveCatalogText(input: {
  readonly sourceText: string
  readonly configuration?: BookingConfiguration | null | undefined
  readonly locale: CatalogLocale
}): ResolvedCatalogText {
  const sourceLocale = input.configuration?.sourceLocale ?? 'en'
  const translated = input.configuration?.nameTranslations?.[input.locale]?.trim()
  return translated
    ? { text: translated, locale: input.locale, isSourceLanguageFallback: false }
    : {
        text: input.sourceText,
        locale: sourceLocale,
        isSourceLanguageFallback: input.locale !== sourceLocale
      }
}

export function resolveCatalogDescription(input: {
  readonly sourceText: string | null | undefined
  readonly configuration?: BookingConfiguration | null | undefined
  readonly locale: CatalogLocale
}): ResolvedCatalogText | null {
  if (!input.sourceText) return null
  const sourceLocale = input.configuration?.sourceLocale ?? 'en'
  const translated =
    input.configuration?.descriptionTranslations?.[input.locale]?.trim()
  return translated
    ? { text: translated, locale: input.locale, isSourceLanguageFallback: false }
    : {
        text: input.sourceText,
        locale: sourceLocale,
        isSourceLanguageFallback: input.locale !== sourceLocale
      }
}

export function resolveBookingConfiguration(input: {
  readonly locale: CatalogLocale
  readonly merchant: {
    readonly name: string
    readonly configuration?: BookingConfiguration | null | undefined
  }
  readonly brand: {
    readonly name: string
    readonly configuration?: BookingConfiguration | null | undefined
  }
  readonly shop: {
    readonly name: string
    readonly configuration?: BookingConfiguration | null | undefined
  }
}): ResolvedBookingConfiguration {
  const shopPalette = validateBookingPalette(input.shop.configuration?.premiumPalette)
  const brandPalette = validateBookingPalette(input.brand.configuration?.premiumPalette)
  const merchantPalette = validateBookingPalette(
    input.merchant.configuration?.premiumPalette
  )
  return {
    merchantName: resolveCatalogText({
      sourceText: input.merchant.name,
      configuration: input.merchant.configuration,
      locale: input.locale
    }),
    brandName: resolveCatalogText({
      sourceText: input.brand.name,
      configuration: input.brand.configuration,
      locale: input.locale
    }),
    shopName: resolveCatalogText({
      sourceText: input.shop.name,
      configuration: input.shop.configuration,
      locale: input.locale
    }),
    adultsOnly:
      input.shop.configuration?.adultsOnly ??
      input.brand.configuration?.adultsOnly ??
      input.merchant.configuration?.adultsOnly ??
      false,
    premiumPalette: shopPalette ?? brandPalette ?? merchantPalette,
    premiumPaletteSource: shopPalette
      ? 'shop'
      : brandPalette
        ? 'brand'
        : merchantPalette
          ? 'merchant'
          : null
  }
}
