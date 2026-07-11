export const BOOKING_LOCALES = ['en', 'es', 'fr', 'ro'] as const
export const BOOKING_CATALOG_VERSION = 1 as const

export type BookingLocale = (typeof BOOKING_LOCALES)[number]

const en = {
  'action.back': 'Back',
  'action.close': 'Close',
  'action.continue': 'Continue',
  'action.retry': 'Try again',
  'action.start_again': 'Start again',
  'feedback.error_generic': 'Something went wrong. Try again.',
  'feedback.loading': 'Preparing your booking…',
  'feedback.source_language': 'Shown in the merchant’s original language',
  'overlay.close': 'Close dialog',
  'status.selection_unavailable': 'Selection unavailable',
  'status.session_expired': 'This Booking Session has expired',
  'status.slot_lost': 'That time was just booked',
  'status.times_unavailable': 'Times unavailable',
  'validation.email_invalid': 'Enter a valid email address.',
  'validation.name_required': 'Enter your name.',
  'validation.phone_invalid': 'Enter a valid phone number.'
} as const

export type BookingTranslationKey = keyof typeof en

const es = {
  'action.back': 'Atrás',
  'action.close': 'Cerrar',
  'action.continue': 'Continuar',
  'action.retry': 'Intentar de nuevo',
  'action.start_again': 'Empezar de nuevo',
  'feedback.error_generic': 'Algo salió mal. Inténtalo de nuevo.',
  'feedback.loading': 'Preparando tu reserva…',
  'feedback.source_language': 'Se muestra en el idioma original del comercio',
  'overlay.close': 'Cerrar diálogo',
  'status.selection_unavailable': 'La selección no está disponible',
  'status.session_expired': 'Esta sesión de reserva ha caducado',
  'status.slot_lost': 'Otra persona acaba de reservar esa hora',
  'status.times_unavailable': 'No hay horarios disponibles',
  'validation.email_invalid': 'Introduce una dirección de correo válida.',
  'validation.name_required': 'Introduce tu nombre.',
  'validation.phone_invalid': 'Introduce un número de teléfono válido.'
} as const satisfies Record<BookingTranslationKey, string>

const fr = {
  'action.back': 'Retour',
  'action.close': 'Fermer',
  'action.continue': 'Continuer',
  'action.retry': 'Réessayer',
  'action.start_again': 'Recommencer',
  'feedback.error_generic': 'Un problème est survenu. Réessayez.',
  'feedback.loading': 'Préparation de votre réservation…',
  'feedback.source_language': 'Affiché dans la langue originale du commerce',
  'overlay.close': 'Fermer la boîte de dialogue',
  'status.selection_unavailable': 'Sélection non disponible',
  'status.session_expired': 'Cette session de réservation a expiré',
  'status.slot_lost': 'Cette heure vient d’être réservée',
  'status.times_unavailable': 'Heures non disponibles',
  'validation.email_invalid': 'Saisissez une adresse courriel valide.',
  'validation.name_required': 'Saisissez votre nom.',
  'validation.phone_invalid': 'Saisissez un numéro de téléphone valide.'
} as const satisfies Record<BookingTranslationKey, string>

const ro = {
  'action.back': 'Înapoi',
  'action.close': 'Închide',
  'action.continue': 'Continuă',
  'action.retry': 'Încearcă din nou',
  'action.start_again': 'Începe din nou',
  'feedback.error_generic': 'Ceva nu a funcționat. Încearcă din nou.',
  'feedback.loading': 'Pregătim rezervarea…',
  'feedback.source_language': 'Afișat în limba originală a comerciantului',
  'overlay.close': 'Închide dialogul',
  'status.selection_unavailable': 'Selecția nu este disponibilă',
  'status.session_expired': 'Această sesiune de rezervare a expirat',
  'status.slot_lost': 'Intervalul tocmai a fost rezervat',
  'status.times_unavailable': 'Orele nu sunt disponibile',
  'validation.email_invalid': 'Introdu o adresă de e-mail validă.',
  'validation.name_required': 'Introdu numele.',
  'validation.phone_invalid': 'Introdu un număr de telefon valid.'
} as const satisfies Record<BookingTranslationKey, string>

export const bookingCatalogs = { en, es, fr, ro } as const satisfies Record<
  BookingLocale,
  Record<BookingTranslationKey, string>
>

export type BookingErrorCode =
  | 'booking.selection_unavailable'
  | 'booking.session_expired'
  | 'booking.slot_lost'
  | 'booking.times_unavailable'
  | 'validation.email_invalid'
  | 'validation.name_required'
  | 'validation.phone_invalid'

const bookingErrorKeys: Record<BookingErrorCode, BookingTranslationKey> = {
  'booking.selection_unavailable': 'status.selection_unavailable',
  'booking.session_expired': 'status.session_expired',
  'booking.slot_lost': 'status.slot_lost',
  'booking.times_unavailable': 'status.times_unavailable',
  'validation.email_invalid': 'validation.email_invalid',
  'validation.name_required': 'validation.name_required',
  'validation.phone_invalid': 'validation.phone_invalid'
}

const localeProfiles: Record<BookingLocale, string> = {
  en: 'en-US',
  es: 'es',
  fr: 'fr-CA',
  ro: 'ro-RO'
}

const isBookingLocale = (value: unknown): value is BookingLocale =>
  typeof value === 'string' && BOOKING_LOCALES.includes(value as BookingLocale)

export const parseBookingLocale = (value: string | null | undefined) => {
  if (!value) return null
  const language = value.trim().toLowerCase().split(/[-_]/)[0]
  return isBookingLocale(language) ? language : null
}

export function resolveBookingLocale(input: {
  readonly sessionLocale?: string | null | undefined
  readonly persistedLocale?: string | null | undefined
  readonly acceptedLanguages?: readonly string[]
}): BookingLocale {
  return (
    parseBookingLocale(input.sessionLocale) ??
    parseBookingLocale(input.persistedLocale) ??
    input.acceptedLanguages?.map(parseBookingLocale).find(isBookingLocale) ??
    'en'
  )
}

export const BOOKING_LOCALE_STORAGE_KEY = 'booking.locale'

export function persistBookingLocale(
  locale: BookingLocale,
  storage: Pick<Storage, 'setItem'>
) {
  storage.setItem(BOOKING_LOCALE_STORAGE_KEY, locale)
}

export function readPersistedBookingLocale(storage: Pick<Storage, 'getItem'>) {
  return parseBookingLocale(storage.getItem(BOOKING_LOCALE_STORAGE_KEY))
}

export function translateBookingMessage(
  locale: BookingLocale,
  key: string,
  reportUnknown: (key: string) => void = reportUnknownBookingMessage
): string {
  const message = bookingCatalogs[locale][key as BookingTranslationKey]
  if (message) return message
  reportUnknown(key)
  return (
    bookingCatalogs.en[key as BookingTranslationKey] ??
    bookingCatalogs[locale]['feedback.error_generic']
  )
}

export function translateBookingError(
  locale: BookingLocale,
  code: string,
  reportUnknown: (code: string) => void = reportUnknownBookingError
) {
  const key = bookingErrorKeys[code as BookingErrorCode]
  if (!key) {
    reportUnknown(code)
    return translateBookingMessage(locale, 'feedback.error_generic')
  }
  return translateBookingMessage(locale, key)
}

const reportUnknownBookingError = (code: string) => {
  if (typeof globalThis.reportError === 'function') {
    globalThis.reportError(
      new Error(`Unknown Booking localization error code: ${code}`)
    )
  }
}

const reportUnknownBookingMessage = (key: string) => {
  if (typeof globalThis.reportError === 'function') {
    globalThis.reportError(new Error(`Unknown Booking localization key: ${key}`))
  }
}

export function formatBookingDate(
  locale: BookingLocale,
  instant: string | Date,
  timeZone: string
) {
  return new Intl.DateTimeFormat(localeProfiles[locale], {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(new Date(instant))
}

export function formatBookingTime(
  locale: BookingLocale,
  instant: string | Date,
  timeZone: string
) {
  return new Intl.DateTimeFormat(localeProfiles[locale], {
    timeZone,
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(instant))
}

const currencyMinorUnits = (currency: string) =>
  new Intl.NumberFormat('en', {
    style: 'currency',
    currency
  }).resolvedOptions().maximumFractionDigits ?? 2

export function formatBookingCurrency(
  locale: BookingLocale,
  amountMinor: number,
  currency: string
) {
  const divisor = 10 ** currencyMinorUnits(currency)
  return new Intl.NumberFormat(localeProfiles[locale], {
    style: 'currency',
    currency
  }).format(amountMinor / divisor)
}

export function formatBookingPhone(e164: string, country: CountryCode) {
  const phone = parsePhoneNumberFromString(e164)
  if (!phone?.isValid()) return e164
  return phone.country === country
    ? phone.formatNational()
    : phone.formatInternational()
}

export type MerchantLocalizedContent = {
  readonly sourceLocale: BookingLocale
  readonly sourceText: string
  readonly translations: Partial<Record<BookingLocale, string>>
}

export function localizeMerchantContent(
  content: MerchantLocalizedContent,
  locale: BookingLocale
) {
  const translated = content.translations[locale]
  return translated
    ? { text: translated, locale, isSourceLanguageFallback: false as const }
    : {
        text: content.sourceText,
        locale: content.sourceLocale,
        isSourceLanguageFallback: locale !== content.sourceLocale
      }
}
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'
