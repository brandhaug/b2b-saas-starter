export const BOOKING_LOCALES = ['en', 'es', 'fr', 'ro'] as const
export const BOOKING_CATALOG_VERSION = 1 as const

export type BookingLocale = (typeof BOOKING_LOCALES)[number]

const en = {
  'action.back': 'Back',
  'action.close': 'Close',
  'action.continue': 'Continue',
  'action.checkout': 'Go to checkout',
  'action.release_time': 'Choose another time',
  'action.retry': 'Try again',
  'action.start_again': 'Start again',
  'party.title': 'Your group',
  'party.add_guest': 'Add guest',
  'party.remove_guest': 'Remove guest',
  'party.move_earlier': 'Move earlier',
  'party.move_later': 'Move later',
  'party.guest': 'Guest',
  'party.incomplete': 'Incomplete',
  'party.complete': 'Complete',
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
  'status.online_payment': 'Paid online',
  'status.selection_unavailable': 'Selection unavailable',
  'status.session_expired': 'This Booking Session has expired',
  'status.slot_lost': 'That time was just booked',
  'status.quote_expired': 'Your price proposal expired',
  'status.quote_stale': 'Your booking details changed',
  'status.quote_superseded': 'A newer price proposal is ready',
  'recovery.quote_copy': 'Review the current price and accept it to continue.',
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
  'scheduling.choose_title': 'Choose your appointment',
  'scheduling.finding_title': 'Finding available times',
  'scheduling.finding_copy': 'Checking professional schedules and current holds…',
  'scheduling.unavailable_copy':
    'Your service choices are still saved. Refresh to try again.',
  'scheduling.saved_copy': 'Your service choices are still saved.',
  'scheduling.expired_title': 'Your held time expired',
  'scheduling.empty_title': 'No times in the next 14 days',
  'scheduling.empty_copy': 'Your professional and service choices are still saved.',
  'scheduling.held_title': 'Your time is held',
  'scheduling.held_copy': 'Your frozen quote remains held for checkout.',
  'scheduling.previous': 'Previous',
  'scheduling.next': 'Next dates',
  'scheduling.selected_with': 'Selected with',
  'scheduling.held_for_checkout': 'held for checkout',
  'validation.email_invalid': 'Enter a valid email address.',
  'validation.name_required': 'Enter your name.',
  'validation.name_too_long': 'Enter a name with 120 characters or fewer.',
  'validation.phone_invalid': 'Enter a valid phone number.',
  'title.appointment_confirmation': 'Appointment Confirmation',
  'confirmation.processing_title': 'Booking processing',
  'confirmation.processing_copy':
    'We are checking your confirmation. No partial appointment has been shown.',
  'confirmation.expired_title': 'This confirmation link has expired',
  'confirmation.expired_copy':
    'Contact the merchant if you still need these appointment details.',
  'checkout.title': 'Confirm booking',
  'checkout.guests': 'Guests',
  'checkout.edit': 'Edit',
  'checkout.email_offers': 'Email offers for',
  'checkout.operational_notifications':
    'Operational booking notifications are sent regardless of marketing consent.',
  'checkout.accept_policy': 'Accept Checkout Policy version',
  'checkout.price_proposal': 'Price proposal',
  'checkout.book': 'Book',
  'checkout.privacy': 'Customer Details are used for this booking.',
  'checkout.privacy_link': 'See the Privacy Policy',
  'checkout.name': 'Name',
  'checkout.email': 'Email',
  'checkout.phone_optional': 'Phone (optional)',
  'checkout.review_booking': 'Review booking',
  'checkout.total': 'Total',
  'payment.method': 'Payment method',
  'payment.card': 'Card',
  'payment.saved_card': 'Saved card',
  'payment.apple_pay': 'Apple Pay',
  'payment.google_pay': 'Google Pay',
  'payment.cash_app_pay': 'Cash App Pay',
  'payment.klarna': 'Buy now, pay later',
  'payment.disabled': 'Online payment is unavailable. You can pay in person.',
  'payment.needs_configuration':
    'Online payment is not configured. You can pay in person.',
  'payment.processing': 'Your payment is processing. Do not submit it again.',
  'payment.failed':
    'Your payment could not be completed. No successful collection was recorded.',
  'payment.succeeded': 'Payment complete.'
} as const

export type BookingTranslationKey = keyof typeof en

const es = {
  'action.back': 'Atrás',
  'action.close': 'Cerrar',
  'action.continue': 'Continuar',
  'action.checkout': 'Ir al pago',
  'action.release_time': 'Elegir otra hora',
  'action.retry': 'Intentar de nuevo',
  'action.start_again': 'Empezar de nuevo',
  'party.title': 'Tu grupo',
  'party.add_guest': 'Añadir invitado',
  'party.remove_guest': 'Eliminar invitado',
  'party.move_earlier': 'Mover antes',
  'party.move_later': 'Mover después',
  'party.guest': 'Invitado',
  'party.incomplete': 'Incompleto',
  'party.complete': 'Completo',
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
  'status.online_payment': 'Pagado en línea',
  'status.selection_unavailable': 'La selección no está disponible',
  'status.session_expired': 'Esta sesión de reserva ha caducado',
  'status.slot_lost': 'Otra persona acaba de reservar esa hora',
  'status.quote_expired': 'Tu propuesta de precio ha caducado',
  'status.quote_stale': 'Los datos de tu reserva han cambiado',
  'status.quote_superseded': 'Hay una nueva propuesta de precio disponible',
  'recovery.quote_copy': 'Revisa el precio actual y acéptalo para continuar.',
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
  'scheduling.choose_title': 'Elige tu cita',
  'scheduling.finding_title': 'Buscando horarios disponibles',
  'scheduling.finding_copy': 'Comprobando los horarios y las reservas temporales…',
  'scheduling.unavailable_copy':
    'Tus servicios siguen guardados. Actualiza para intentarlo de nuevo.',
  'scheduling.saved_copy': 'Tus servicios siguen guardados.',
  'scheduling.expired_title': 'Tu horario reservado ha caducado',
  'scheduling.empty_title': 'No hay horarios en los próximos 14 días',
  'scheduling.empty_copy': 'Tu profesional y tus servicios siguen guardados.',
  'scheduling.held_title': 'Tu horario está reservado',
  'scheduling.held_copy': 'Tu presupuesto permanece reservado para el pago.',
  'scheduling.previous': 'Anterior',
  'scheduling.next': 'Siguientes fechas',
  'scheduling.selected_with': 'Seleccionado con',
  'scheduling.held_for_checkout': 'reservado para el pago',
  'validation.email_invalid': 'Introduce una dirección de correo válida.',
  'validation.name_required': 'Introduce tu nombre.',
  'validation.name_too_long': 'Introduce un nombre de 120 caracteres o menos.',
  'validation.phone_invalid': 'Introduce un número de teléfono válido.',
  'title.appointment_confirmation': 'Confirmación de la cita',
  'confirmation.processing_title': 'Reserva en proceso',
  'confirmation.processing_copy':
    'Estamos comprobando la confirmación. No se muestra ninguna cita parcial.',
  'confirmation.expired_title': 'Este enlace de confirmación ha caducado',
  'confirmation.expired_copy':
    'Contacta con el comercio si aún necesitas los detalles de la cita.',
  'checkout.title': 'Confirmar reserva',
  'checkout.guests': 'Personas',
  'checkout.edit': 'Editar',
  'checkout.email_offers': 'Ofertas por correo para',
  'checkout.operational_notifications':
    'Las notificaciones de la reserva se envían independientemente del consentimiento de marketing.',
  'checkout.accept_policy': 'Aceptar la versión de la política de reserva',
  'checkout.price_proposal': 'Propuesta de precio',
  'checkout.book': 'Reservar',
  'checkout.privacy': 'Los datos del cliente se usan para esta reserva.',
  'checkout.privacy_link': 'Ver la Política de privacidad',
  'checkout.name': 'Nombre',
  'checkout.email': 'Correo electrónico',
  'checkout.phone_optional': 'Teléfono (opcional)',
  'checkout.review_booking': 'Revisar reserva',
  'checkout.total': 'Total',
  'payment.method': 'Método de pago',
  'payment.card': 'Tarjeta',
  'payment.saved_card': 'Tarjeta guardada',
  'payment.apple_pay': 'Apple Pay',
  'payment.google_pay': 'Google Pay',
  'payment.cash_app_pay': 'Cash App Pay',
  'payment.klarna': 'Compra ahora y paga después',
  'payment.disabled': 'El pago en línea no está disponible. Puedes pagar en persona.',
  'payment.needs_configuration':
    'El pago en línea no está configurado. Puedes pagar en persona.',
  'payment.processing': 'Tu pago se está procesando. No lo envíes de nuevo.',
  'payment.failed':
    'No se pudo completar el pago. No se registró ningún cobro correcto.',
  'payment.succeeded': 'Pago completado.'
} as const satisfies Record<BookingTranslationKey, string>

const fr = {
  'action.back': 'Retour',
  'action.close': 'Fermer',
  'action.continue': 'Continuer',
  'action.checkout': 'Passer au paiement',
  'action.release_time': 'Choisir une autre heure',
  'action.retry': 'Réessayer',
  'action.start_again': 'Recommencer',
  'party.title': 'Votre groupe',
  'party.add_guest': 'Ajouter une personne',
  'party.remove_guest': 'Retirer la personne',
  'party.move_earlier': 'Déplacer avant',
  'party.move_later': 'Déplacer après',
  'party.guest': 'Personne',
  'party.incomplete': 'Incomplet',
  'party.complete': 'Complet',
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
  'status.online_payment': 'Payé en ligne',
  'status.selection_unavailable': 'Sélection non disponible',
  'status.session_expired': 'Cette session de réservation a expiré',
  'status.slot_lost': 'Cette heure vient d’être réservée',
  'status.quote_expired': 'Votre proposition de prix a expiré',
  'status.quote_stale': 'Les détails de votre réservation ont changé',
  'status.quote_superseded': 'Une nouvelle proposition de prix est disponible',
  'recovery.quote_copy': 'Vérifiez le prix actuel et acceptez-le pour continuer.',
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
  'scheduling.choose_title': 'Choisissez votre rendez-vous',
  'scheduling.finding_title': 'Recherche des heures disponibles',
  'scheduling.finding_copy': 'Vérification des horaires et des créneaux retenus…',
  'scheduling.unavailable_copy':
    'Vos services sont toujours enregistrés. Actualisez pour réessayer.',
  'scheduling.saved_copy': 'Vos services sont toujours enregistrés.',
  'scheduling.expired_title': 'Votre créneau retenu a expiré',
  'scheduling.empty_title': 'Aucune heure dans les 14 prochains jours',
  'scheduling.empty_copy':
    'Votre professionnel et vos services sont toujours enregistrés.',
  'scheduling.held_title': 'Votre créneau est retenu',
  'scheduling.held_copy': 'Votre devis reste retenu pour le paiement.',
  'scheduling.previous': 'Précédent',
  'scheduling.next': 'Dates suivantes',
  'scheduling.selected_with': 'Sélectionné avec',
  'scheduling.held_for_checkout': 'retenu pour le paiement',
  'validation.email_invalid': 'Saisissez une adresse courriel valide.',
  'validation.name_required': 'Saisissez votre nom.',
  'validation.name_too_long': 'Saisissez un nom de 120 caractères maximum.',
  'validation.phone_invalid': 'Saisissez un numéro de téléphone valide.',
  'title.appointment_confirmation': 'Confirmation du rendez-vous',
  'confirmation.processing_title': 'Réservation en cours',
  'confirmation.processing_copy':
    'Nous vérifions la confirmation. Aucun rendez-vous partiel n’est affiché.',
  'confirmation.expired_title': 'Ce lien de confirmation a expiré',
  'confirmation.expired_copy':
    'Communiquez avec le commerce si vous avez encore besoin des détails.',
  'checkout.title': 'Confirmer la réservation',
  'checkout.guests': 'Personnes',
  'checkout.edit': 'Modifier',
  'checkout.email_offers': 'Offres par courriel pour',
  'checkout.operational_notifications':
    'Les notifications de réservation sont envoyées indépendamment du consentement marketing.',
  'checkout.accept_policy': 'Accepter la version de la politique de réservation',
  'checkout.price_proposal': 'Proposition de prix',
  'checkout.book': 'Réserver',
  'checkout.privacy': 'Les coordonnées client servent à cette réservation.',
  'checkout.privacy_link': 'Voir la politique de confidentialité',
  'checkout.name': 'Nom',
  'checkout.email': 'E-mail',
  'checkout.phone_optional': 'Téléphone (facultatif)',
  'checkout.review_booking': 'Vérifier la réservation',
  'checkout.total': 'Total',
  'payment.method': 'Mode de paiement',
  'payment.card': 'Carte',
  'payment.saved_card': 'Carte enregistrée',
  'payment.apple_pay': 'Apple Pay',
  'payment.google_pay': 'Google Pay',
  'payment.cash_app_pay': 'Cash App Pay',
  'payment.klarna': 'Acheter maintenant, payer plus tard',
  'payment.disabled':
    'Le paiement en ligne est indisponible. Vous pouvez payer sur place.',
  'payment.needs_configuration':
    'Le paiement en ligne n’est pas configuré. Vous pouvez payer sur place.',
  'payment.processing': 'Votre paiement est en cours. Ne le soumettez pas à nouveau.',
  'payment.failed':
    'Votre paiement n’a pas abouti. Aucun encaissement réussi n’a été enregistré.',
  'payment.succeeded': 'Paiement effectué.'
} as const satisfies Record<BookingTranslationKey, string>

const ro = {
  'action.back': 'Înapoi',
  'action.close': 'Închide',
  'action.continue': 'Continuă',
  'action.checkout': 'Continuă la plată',
  'action.release_time': 'Alege alt interval',
  'action.retry': 'Încearcă din nou',
  'action.start_again': 'Începe din nou',
  'party.title': 'Grupul tău',
  'party.add_guest': 'Adaugă invitat',
  'party.remove_guest': 'Elimină invitatul',
  'party.move_earlier': 'Mută mai devreme',
  'party.move_later': 'Mută mai târziu',
  'party.guest': 'Invitat',
  'party.incomplete': 'Incomplet',
  'party.complete': 'Complet',
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
  'status.online_payment': 'Plătit online',
  'status.selection_unavailable': 'Selecția nu este disponibilă',
  'status.session_expired': 'Această sesiune de rezervare a expirat',
  'status.slot_lost': 'Intervalul tocmai a fost rezervat',
  'status.quote_expired': 'Propunerea de preț a expirat',
  'status.quote_stale': 'Detaliile rezervării s-au schimbat',
  'status.quote_superseded': 'Este disponibilă o propunere de preț nouă',
  'recovery.quote_copy': 'Verifică prețul actual și acceptă-l pentru a continua.',
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
  'scheduling.choose_title': 'Alege programarea',
  'scheduling.finding_title': 'Căutăm intervale disponibile',
  'scheduling.finding_copy':
    'Verificăm programul profesioniștilor și intervalele rezervate…',
  'scheduling.unavailable_copy':
    'Serviciile alese sunt salvate. Reîncarcă pentru a încerca din nou.',
  'scheduling.saved_copy': 'Serviciile alese sunt salvate.',
  'scheduling.expired_title': 'Intervalul rezervat a expirat',
  'scheduling.empty_title': 'Nu sunt intervale în următoarele 14 zile',
  'scheduling.empty_copy': 'Profesionistul și serviciile alese sunt salvate.',
  'scheduling.held_title': 'Intervalul tău este rezervat',
  'scheduling.held_copy': 'Oferta rămâne rezervată pentru finalizare.',
  'scheduling.previous': 'Înapoi',
  'scheduling.next': 'Datele următoare',
  'scheduling.selected_with': 'Selectat cu',
  'scheduling.held_for_checkout': 'rezervat pentru finalizare',
  'validation.email_invalid': 'Introdu o adresă de e-mail validă.',
  'validation.name_required': 'Introdu numele.',
  'validation.name_too_long': 'Introdu un nume de cel mult 120 de caractere.',
  'validation.phone_invalid': 'Introdu un număr de telefon valid.',
  'title.appointment_confirmation': 'Confirmarea programării',
  'confirmation.processing_title': 'Rezervare în curs',
  'confirmation.processing_copy':
    'Verificăm confirmarea. Nu este afișată nicio programare parțială.',
  'confirmation.expired_title': 'Acest link de confirmare a expirat',
  'confirmation.expired_copy':
    'Contactează comerciantul dacă mai ai nevoie de detaliile programării.',
  'checkout.title': 'Confirmă rezervarea',
  'checkout.guests': 'Persoane',
  'checkout.edit': 'Editează',
  'checkout.email_offers': 'Oferte prin e-mail pentru',
  'checkout.operational_notifications':
    'Notificările operaționale ale rezervării sunt trimise indiferent de consimțământul de marketing.',
  'checkout.accept_policy': 'Acceptă versiunea politicii de rezervare',
  'checkout.price_proposal': 'Propunere de preț',
  'checkout.book': 'Rezervă',
  'checkout.privacy': 'Datele clientului sunt folosite pentru această rezervare.',
  'checkout.privacy_link': 'Vezi Politica de confidențialitate',
  'checkout.name': 'Nume',
  'checkout.email': 'E-mail',
  'checkout.phone_optional': 'Telefon (opțional)',
  'checkout.review_booking': 'Verifică rezervarea',
  'checkout.total': 'Total',
  'payment.method': 'Metodă de plată',
  'payment.card': 'Card',
  'payment.saved_card': 'Card salvat',
  'payment.apple_pay': 'Apple Pay',
  'payment.google_pay': 'Google Pay',
  'payment.cash_app_pay': 'Cash App Pay',
  'payment.klarna': 'Cumpără acum, plătește mai târziu',
  'payment.disabled': 'Plata online nu este disponibilă. Poți plăti în persoană.',
  'payment.needs_configuration':
    'Plata online nu este configurată. Poți plăti în persoană.',
  'payment.processing': 'Plata ta este în curs. Nu o trimite din nou.',
  'payment.failed':
    'Plata nu a putut fi finalizată. Nu a fost înregistrată nicio încasare reușită.',
  'payment.succeeded': 'Plată finalizată.'
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
