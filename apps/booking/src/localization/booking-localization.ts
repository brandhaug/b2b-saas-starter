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
  'feedback.selection_refreshed':
    'Your booking changed in another tab. We reloaded the latest choices.',
  'feedback.source_language': 'Shown in the merchant’s original language',
  'label.duration': 'Duration',
  'label.language': 'Language',
  'label.merchant': 'Merchant',
  'label.provider': 'Provider',
  'label.shop': 'Shop',
  'label.time': 'Time',
  'label.timezone': 'Timezone',
  'label.total_price': 'Total price',
  'overlay.close': 'Close dialog',
  'recovery.booking_not_found_copy':
    'Check the merchant link or start the booking again.',
  'recovery.booking_not_found_title': 'Booking page not found',
  'recovery.session_expired_copy': 'Start again to choose a new appointment.',
  'status.appointment_cancelled': 'Cancelled',
  'status.appointment_completed': 'Completed',
  'status.appointment_no_show': 'No show',
  'status.appointment_scheduled': 'Scheduled',
  'status.pay_in_person': 'Pay in person',
  'status.selection_unavailable': 'Selection unavailable',
  'status.session_expired': 'This Booking Session has expired',
  'status.slot_lost': 'That time was just booked',
  'status.times_unavailable': 'Times unavailable',
  'selection.choose_provider': 'Choose a professional',
  'selection.choose_service': 'What can we do for you?',
  'selection.any_provider': 'Book with any professional',
  'selection.provider_restricted': 'This professional requires private access',
  'selection.no_services_title': 'No services are bookable',
  'selection.no_services_copy':
    'There are no active services available for your professional choice.',
  'selection.inactive_entities_copy':
    'Previously available professionals or services are no longer active. Choose another option.',
  'selection.invalid_associations_copy':
    'The available professionals and services cannot currently be booked together.',
  'selection.unavailable_title': 'Selection unavailable',
  'selection.unavailable_copy':
    'Your selection was not changed. Refresh to continue this Booking Session.',
  'validation.email_invalid': 'Enter a valid email address.',
  'validation.name_required': 'Enter your name.',
  'validation.phone_invalid': 'Enter a valid phone number.',
  'title.appointment_confirmation': 'Appointment Confirmation'
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
  'feedback.selection_refreshed':
    'Tu reserva cambió en otra pestaña. Cargamos las opciones más recientes.',
  'feedback.source_language': 'Se muestra en el idioma original del comercio',
  'label.duration': 'Duración',
  'label.language': 'Idioma',
  'label.merchant': 'Comercio',
  'label.provider': 'Profesional',
  'label.shop': 'Local',
  'label.time': 'Hora',
  'label.timezone': 'Zona horaria',
  'label.total_price': 'Precio total',
  'overlay.close': 'Cerrar diálogo',
  'recovery.booking_not_found_copy':
    'Comprueba el enlace del comercio o vuelve a iniciar la reserva.',
  'recovery.booking_not_found_title': 'Página de reserva no encontrada',
  'recovery.session_expired_copy': 'Empieza de nuevo para elegir otra cita.',
  'status.appointment_cancelled': 'Cancelada',
  'status.appointment_completed': 'Completada',
  'status.appointment_no_show': 'No asistió',
  'status.appointment_scheduled': 'Programada',
  'status.pay_in_person': 'Pagar en persona',
  'status.selection_unavailable': 'La selección no está disponible',
  'status.session_expired': 'Esta sesión de reserva ha caducado',
  'status.slot_lost': 'Otra persona acaba de reservar esa hora',
  'status.times_unavailable': 'No hay horarios disponibles',
  'selection.choose_provider': 'Elige un profesional',
  'selection.choose_service': '¿Qué podemos hacer por ti?',
  'selection.any_provider': 'Reservar con cualquier profesional',
  'selection.provider_restricted': 'Este profesional requiere acceso privado',
  'selection.no_services_title': 'No hay servicios disponibles',
  'selection.no_services_copy':
    'No hay servicios activos disponibles para tu elección de profesional.',
  'selection.inactive_entities_copy':
    'Algunos profesionales o servicios ya no están activos. Elige otra opción.',
  'selection.invalid_associations_copy':
    'Los profesionales y servicios disponibles no se pueden reservar juntos ahora.',
  'selection.unavailable_title': 'Selección no disponible',
  'selection.unavailable_copy':
    'Tu selección no cambió. Actualiza para continuar esta sesión de reserva.',
  'validation.email_invalid': 'Introduce una dirección de correo válida.',
  'validation.name_required': 'Introduce tu nombre.',
  'validation.phone_invalid': 'Introduce un número de teléfono válido.',
  'title.appointment_confirmation': 'Confirmación de la cita'
} as const satisfies Record<BookingTranslationKey, string>

const fr = {
  'action.back': 'Retour',
  'action.close': 'Fermer',
  'action.continue': 'Continuer',
  'action.retry': 'Réessayer',
  'action.start_again': 'Recommencer',
  'feedback.error_generic': 'Un problème est survenu. Réessayez.',
  'feedback.loading': 'Préparation de votre réservation…',
  'feedback.selection_refreshed':
    'Votre réservation a changé dans un autre onglet. Les choix récents ont été rechargés.',
  'feedback.source_language': 'Affiché dans la langue originale du commerce',
  'label.duration': 'Durée',
  'label.language': 'Langue',
  'label.merchant': 'Commerce',
  'label.provider': 'Professionnel',
  'label.shop': 'Établissement',
  'label.time': 'Heure',
  'label.timezone': 'Fuseau horaire',
  'label.total_price': 'Prix total',
  'overlay.close': 'Fermer la boîte de dialogue',
  'recovery.booking_not_found_copy':
    'Vérifiez le lien du commerce ou recommencez la réservation.',
  'recovery.booking_not_found_title': 'Page de réservation introuvable',
  'recovery.session_expired_copy': 'Recommencez pour choisir un nouveau rendez-vous.',
  'status.appointment_cancelled': 'Annulé',
  'status.appointment_completed': 'Terminé',
  'status.appointment_no_show': 'Absence',
  'status.appointment_scheduled': 'Planifié',
  'status.pay_in_person': 'Payer sur place',
  'status.selection_unavailable': 'Sélection non disponible',
  'status.session_expired': 'Cette session de réservation a expiré',
  'status.slot_lost': 'Cette heure vient d’être réservée',
  'status.times_unavailable': 'Heures non disponibles',
  'selection.choose_provider': 'Choisissez un professionnel',
  'selection.choose_service': 'Que pouvons-nous faire pour vous?',
  'selection.any_provider': 'Réserver avec n’importe quel professionnel',
  'selection.provider_restricted': 'Ce professionnel nécessite un accès privé',
  'selection.no_services_title': 'Aucun service réservable',
  'selection.no_services_copy':
    'Aucun service actif n’est disponible pour votre choix de professionnel.',
  'selection.inactive_entities_copy':
    'Des professionnels ou services ne sont plus actifs. Choisissez une autre option.',
  'selection.invalid_associations_copy':
    'Les professionnels et services disponibles ne peuvent pas être réservés ensemble.',
  'selection.unavailable_title': 'Sélection non disponible',
  'selection.unavailable_copy':
    'Votre sélection n’a pas changé. Actualisez pour poursuivre cette session.',
  'validation.email_invalid': 'Saisissez une adresse courriel valide.',
  'validation.name_required': 'Saisissez votre nom.',
  'validation.phone_invalid': 'Saisissez un numéro de téléphone valide.',
  'title.appointment_confirmation': 'Confirmation du rendez-vous'
} as const satisfies Record<BookingTranslationKey, string>

const ro = {
  'action.back': 'Înapoi',
  'action.close': 'Închide',
  'action.continue': 'Continuă',
  'action.retry': 'Încearcă din nou',
  'action.start_again': 'Începe din nou',
  'feedback.error_generic': 'Ceva nu a funcționat. Încearcă din nou.',
  'feedback.loading': 'Pregătim rezervarea…',
  'feedback.selection_refreshed':
    'Rezervarea s-a schimbat în altă filă. Am reîncărcat opțiunile recente.',
  'feedback.source_language': 'Afișat în limba originală a comerciantului',
  'label.duration': 'Durată',
  'label.language': 'Limbă',
  'label.merchant': 'Comerciant',
  'label.provider': 'Profesionist',
  'label.shop': 'Locație',
  'label.time': 'Oră',
  'label.timezone': 'Fus orar',
  'label.total_price': 'Preț total',
  'overlay.close': 'Închide dialogul',
  'recovery.booking_not_found_copy':
    'Verifică linkul comerciantului sau începe din nou rezervarea.',
  'recovery.booking_not_found_title': 'Pagina de rezervare nu a fost găsită',
  'recovery.session_expired_copy': 'Începe din nou pentru a alege o programare nouă.',
  'status.appointment_cancelled': 'Anulată',
  'status.appointment_completed': 'Finalizată',
  'status.appointment_no_show': 'Neprezentare',
  'status.appointment_scheduled': 'Programată',
  'status.pay_in_person': 'Plată la locație',
  'status.selection_unavailable': 'Selecția nu este disponibilă',
  'status.session_expired': 'Această sesiune de rezervare a expirat',
  'status.slot_lost': 'Intervalul tocmai a fost rezervat',
  'status.times_unavailable': 'Orele nu sunt disponibile',
  'selection.choose_provider': 'Alege un profesionist',
  'selection.choose_service': 'Cu ce te putem ajuta?',
  'selection.any_provider': 'Rezervă cu orice profesionist',
  'selection.provider_restricted': 'Acest profesionist necesită acces privat',
  'selection.no_services_title': 'Nu există servicii disponibile',
  'selection.no_services_copy': 'Nu există servicii active pentru profesionistul ales.',
  'selection.inactive_entities_copy':
    'Unii profesioniști sau unele servicii nu mai sunt active. Alege altă opțiune.',
  'selection.invalid_associations_copy':
    'Profesioniștii și serviciile disponibile nu pot fi rezervate împreună acum.',
  'selection.unavailable_title': 'Selecția nu este disponibilă',
  'selection.unavailable_copy':
    'Selecția nu a fost modificată. Reîncarcă pentru a continua sesiunea.',
  'validation.email_invalid': 'Introdu o adresă de e-mail validă.',
  'validation.name_required': 'Introdu numele.',
  'validation.phone_invalid': 'Introdu un număr de telefon valid.',
  'title.appointment_confirmation': 'Confirmarea programării'
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
