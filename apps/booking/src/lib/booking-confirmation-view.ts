import type { ConfirmationReadResult } from '@b2b-saas-starter/capabilities/booking'
import { translateBookingMessage } from '../localization/booking-localization.ts'

type Confirmation = Extract<ConfirmationReadResult, { kind: 'found' }>['confirmation']

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!
  )

const inlineScriptJson = (value: string) =>
  JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')

const safeCssImageUrl = (value: string | undefined) => {
  if (!value) return ''
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    return url.href.replace(
      /["'()\\]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    )
  } catch {
    return ''
  }
}

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

const legacyCurrency = (
  locale: Confirmation['locale'],
  amountMinor: number,
  currency: string
) =>
  new Intl.NumberFormat(locale === 'fr' ? 'fr-CA' : 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amountMinor / 100)

const ordinal = (day: number) => {
  if (day >= 11 && day <= 13) return `${day}th`
  if (day % 10 === 1) return `${day}st`
  if (day % 10 === 2) return `${day}nd`
  if (day % 10 === 3) return `${day}rd`
  return `${day}th`
}

const reservationDateTime = (
  locale: Confirmation['locale'],
  instant: string,
  timeZone: string,
  at: string
) => {
  const date = new Date(instant)
  const dateParts = new Intl.DateTimeFormat(locale, {
    timeZone,
    month: 'short',
    day: 'numeric'
  }).formatToParts(date)
  const day = Number(dateParts.find((part) => part.type === 'day')?.value)
  const month = dateParts.find((part) => part.type === 'month')?.value ?? ''
  const formattedDate = locale === 'en' ? `${month} ${ordinal(day)}` : `${day} ${month}`
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit'
  })
    .format(date)
    .replace(/\s([AP]M)$/i, '$1')
  return `${formattedDate}\u00a0${at}\u00a0${time}`
}

const successIcon = (cancelled: boolean) =>
  cancelled
    ? `<svg class="reservation-title-icon" viewBox="0 0 42 42" aria-hidden="true"><circle cx="21" cy="21" r="21" fill="#FF3B30"/><path fill-rule="evenodd" clip-rule="evenodd" d="M16.0306 17.1263C16.0691 17.28 16.1417 17.4103 16.2485 17.5172L19.7327 21.0013L16.2475 24.4892C16.1407 24.5917 16.0681 24.721 16.0297 24.8769C15.9912 25.0328 15.9901 25.1888 16.0265 25.3447C16.0628 25.5006 16.1386 25.6341 16.2539 25.7452C16.3693 25.8606 16.5049 25.9364 16.6609 25.9727C16.8168 26.009 16.9706 26.009 17.1223 25.9727C17.2739 25.9364 17.4053 25.8648 17.5164 25.758L21.0028 22.2715L24.483 25.7518C24.5941 25.8628 24.7266 25.9365 24.8804 25.9728C25.0342 26.0092 25.1879 26.0081 25.3417 25.9696C25.4955 25.9312 25.6301 25.8564 25.7455 25.7453C25.8608 25.6257 25.9377 25.489 25.9762 25.3352C26.0146 25.1814 26.0146 25.0287 25.9762 24.877C25.9377 24.7254 25.8651 24.594 25.7583 24.4829L22.2749 20.9995L25.7573 17.517C25.8641 17.406 25.9368 17.2735 25.9752 17.1197C26.0137 16.9659 26.0137 16.8121 25.9752 16.6583C25.9368 16.5045 25.8599 16.37 25.7445 16.2546C25.6292 16.1435 25.4935 16.0688 25.3376 16.0303C25.1817 15.9919 25.0279 15.9908 24.8762 16.0271C24.7245 16.0634 24.5932 16.1371 24.4821 16.2482L21.0042 19.7288L17.5173 16.2419C17.4062 16.1351 17.2749 16.0635 17.1232 16.0272C16.9716 15.9909 16.8178 15.9909 16.6618 16.0272C16.5059 16.0635 16.3702 16.1394 16.2549 16.2547C16.1438 16.3701 16.0691 16.5057 16.0306 16.6617C15.9922 16.8176 15.9922 16.9725 16.0306 17.1263Z" fill="#fff"/></svg>`
    : `<svg class="reservation-title-icon" viewBox="0 0 42 42" aria-hidden="true"><circle cx="21" cy="21" r="21" fill="#2CAF00"/><path d="m14.7 21 4.214 4.2 8.385-8.4" fill="none" stroke="#fff" stroke-width="2"/></svg>`

const calendarIcon = (kind: 'apple' | 'google' | 'yahoo') => {
  if (kind === 'apple')
    return `<svg viewBox="0 0 14 16" aria-hidden="true"><path fill="currentColor" d="m10.8825 8.5003c.0225 2.4213 2.1241 3.2271 2.1474 3.2373-.0177.0568-.3358 1.1483-1.1072 2.2757-.6669.9747-1.359 1.9458-2.44932 1.9659-1.07133.0197-1.41582-.6353-2.64066-.6353-1.22447 0-1.60721.6152-2.62135.655-1.05242.0399-1.85386-1.0539-2.52624-2.0251-1.374002-1.9864-2.424022-5.61318-1.01411-8.06131.70041-1.21576 1.95211-1.98562 3.31071-2.00536 1.03345-.01972 2.00887.69527 2.64066.69527.63139 0 1.81674-.85983 3.06289-.73356.52172.02172 1.98612.21073 2.92632 1.58711-.0757.04696-1.7472 1.02005-1.7291 3.04435zm-2.01342-5.94566c.55873-.67633.93479-1.617841.8322-2.55464-.80538.0323694-1.77926.536681-2.35694 1.21264-.51771.59859-.97111 1.55667-.84877 2.47493.89769.06945 1.81474-.45617 2.37351-1.13293z"/></svg>`
  if (kind === 'google')
    return `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="m15.9914 8.1497c0-.65551-.0545-1.13386-.1723-1.62992h-7.65992v2.95865h4.49622c-.0906.73527-.5801 1.84257-1.6679 2.58667l-.0153.099 2.4219 1.8335.1678.0163c1.5411-1.3907 2.4295-3.437 2.4295-5.8642zM8.15943 15.9451c2.20277 0 4.05207-.7087 5.40277-1.9311l-2.5745-1.9489c-.6889.4695-1.61358.7972-2.82827.7972-2.15747 0-3.9886-1.3907-4.64135-3.31298l-.09568.00794-2.518372 1.90454-.032934.0895c1.341616 2.6043 4.097406 4.3938 7.288336 4.3938zM3.51818 9.54912c-.17224-.49606-.27191-1.02761-.27191-1.5768 0-.54925.09967-1.08073.26284-1.57679l-.00456-.10565-2.549922-1.93514-.083429.03878c-.552943 1.08073-.87022244 2.29435-.87022244 3.5788 0 1.28446.31727944 2.49798.87022244 3.57878zM8.1594 3.08269c1.53197 0 2.5654.64665 3.1546 1.18705l2.3025-2.19689c-1.4141-1.284453-3.2543-2.07285-5.4571-2.07285-3.19092 0-5.94669 1.78937-7.288306 4.39371l2.637916 2.00201c.66181-1.92225 2.49293-3.31303 4.65039-3.31303z"/></svg>`
  return `<svg viewBox="0 -1 14 16" aria-hidden="true"><path fill="currentColor" d="M13.6629 0H9.35569L6.83145 5.8907L4.30721 0H0C1.56462 3.65123 3.12863 7.30307 4.69387 10.9539L2.96001 15H7.26723C9.42114 9.97345 11.523 4.99383 13.6629 0Z"/></svg>`
}

const payInPersonIcon = `<svg viewBox="0 0 38 24" aria-hidden="true"><rect width="38" height="24" rx="3" fill="#000"/><path d="M22.8 6H15.2L13 9V10.5C13 11.3284 13.6716 12 14.5 12S16 11.3284 16 10.5C16 11.3284 16.6716 12 17.5 12S19 11.3284 19 10.5C19 11.3284 19.6716 12 20.5 12S22 11.3284 22 10.5C22 11.3284 22.6716 12 23.5 12S25 11.3284 25 10.5V9L22.8 6Z" fill="#fff"/><path fill-rule="evenodd" d="M14 13.9655V17C14 17.5523 14.4477 18 15 18H23C23.5523 18 24 17.5523 24 17V13.9655C23.8367 13.9888 23.6698 14 23.5 14C22.9632 14 22.4546 13.879 22 13.663C21.5454 13.879 21.0368 14 20.5 14C19.9632 14 19.4546 13.879 19 13.663C18.5454 13.879 18.0368 14 17.5 14C16.9632 14 16.4546 13.879 16 13.663C15.5454 13.879 15.0368 14 14.5 14C14.3302 14 14.1633 13.9888 14 13.9655ZM20.5 15V18H17.5V15H20.5Z" fill="#fff"/></svg>`

const closeIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#EBEBEB"/><path fill-rule="evenodd" clip-rule="evenodd" d="M7.176 15.971a.6.6 0 1 0 .849.849L12 12.846l3.975 3.974a.6.6 0 0 0 .849-.849l-3.975-3.973 3.975-3.974a.6.6 0 1 0-.849-.848L12 11.149 8.025 7.176a.6.6 0 0 0-.849.848l3.975 3.974-3.975 3.973z" fill="currentColor"/></svg>`

const styles = `<style>:root{color-scheme:light;font-family:"SF Pro Text",Roboto,sans-serif}*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#323536;color:#000}button{font:inherit;-webkit-tap-highlight-color:transparent}.reservation-widget{position:relative;width:100%;max-width:375px;height:100dvh;min-height:568px;margin:0 auto;overflow:hidden;background:#f7f7f7}.reservation-title{position:absolute;z-index:4;top:0;right:0;left:0;display:flex;padding:24px 16px;transition:background-color .3s}.reservation-title.is-scrolled{background:rgba(247,247,247,.85);backdrop-filter:blur(4px)}.reservation-title-content{display:flex;align-items:center;gap:16px;padding-top:8px;padding-right:36px}.reservation-title-icon{width:42px;height:42px;flex:0 0 42px;margin-top:3px;animation:reservation-icon-in .3s .3s both}.reservation-title h1{margin:0;font-family:"SF Pro Display",Roboto,sans-serif;font-size:20px;font-weight:600;line-height:24px;letter-spacing:.38px}.reservation-status{position:absolute;overflow:hidden;width:1px;height:1px;clip:rect(0 0 0 0)}.reservation-content{position:absolute;inset:0;overflow-x:hidden;overflow-y:auto;padding:104px 16px 32px;scrollbar-width:none}.reservation-content::-webkit-scrollbar{display:none}.order-appointment{position:relative;margin-bottom:12px;padding:20px 16px;border-radius:8px;background:#ebebeb}.appointment-card{display:grid;grid-template-columns:48px minmax(0,1fr) auto;grid-template-rows:auto auto auto;column-gap:12px;align-items:start}.provider-avatar{display:flex;width:48px;height:48px;grid-row:1/4;align-items:center;justify-content:center;border-radius:8px;background:#d2d2d4;color:#616163;font-size:15px;font-weight:600}.provider-name,.appointment-total{font-size:15px;font-weight:600;line-height:20px}.provider-name,.service-name,.customer-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.service-name,.service-price,.customer-name{color:#616163;font-size:13px;line-height:18px}.appointment-total,.service-price{text-align:right}.service-addons{display:grid;grid-column:2/4;gap:16px;margin-top:16px}.service-addon{display:flex;justify-content:space-between;color:#616163;font-size:13px}.breakdown{display:grid;gap:16px;margin-top:23px}.breakdown-row,.order-total,.group-total{display:flex;align-items:center;justify-content:space-between;gap:16px}.breakdown-row>*{color:#616163;font-size:13px;line-height:18px}.confirmation-code{padding:4px 8px;border-radius:4px;background:#dadadc;color:#000!important}.appointment-time{max-width:68%;overflow:hidden;text-align:right;text-overflow:ellipsis;white-space:nowrap}.appointment-time.is-clickable{border:0;background:transparent;color:#1677d2;cursor:pointer}.calendar{margin-top:20px}.calendar p{margin:0;color:#616163;font-size:13px}.calendar-actions{display:flex;gap:9px;margin-top:12px}.calendar-actions button{display:flex;width:100%;height:40px;align-items:center;justify-content:center;padding:0;border:1px solid #dadadc;border-radius:8px;background:transparent;color:#000;cursor:pointer}.calendar-actions svg{width:20px;height:20px}.divider{height:1px;margin:20px 0;border:0;background:#dadadc}.order-total,.group-total{font-size:15px}.taxes-toggle{display:flex;align-items:center;margin-top:2px;padding:0;border:0;background:transparent;color:#616163;font-size:11px;cursor:pointer}.taxes-toggle svg{width:4px;height:7px;margin-left:4px;transform:rotate(90deg)}.group-total{margin:24px 0}.schedule-another-wrapper{margin-top:16px}.shop-marker{display:flex;margin-top:24px}.shop-cover{display:flex;width:76px;height:76px;flex:0 0 76px;align-items:center;justify-content:center;border-radius:8px;background-position:50% 50%;background-size:248px 248px}.shop-cover.is-placeholder{background:repeating-linear-gradient(-45deg,#e1e1e1 0,#e1e1e1 4px,#dadadc 5px,#dadadc 6px)}.shop-pin{width:16px;height:16px;border:3px solid #fff;border-radius:50%;background:#0083ff;box-shadow:0 4px 16px rgba(0,0,0,.24)}.shop-copy{display:flex;min-width:0;flex-direction:column;padding-left:16px}.shop-copy strong{font-size:15px;line-height:20px}.shop-copy span{margin-top:2px;color:#616163;font-size:11px;line-height:15px}.directions{align-self:flex-start;margin-top:auto;padding:0;border:0;background:transparent;color:#1677d2;font-size:13px;cursor:pointer}.reservation-divider{height:1px;margin:24px 0;border:0;background:#dadadc}.payment-info{margin-top:24px}.payment-title{display:flex;align-items:center}.payment-title svg{width:38px;height:24px}.payment-title strong{margin-left:16px;font-size:15px}.payment-label{display:flex;height:21px;align-items:center;margin-left:auto;padding:0 8px;border-radius:4px;background:#2caf00;color:#fff;font-size:10px;font-weight:600;line-height:6px;text-transform:uppercase}.payment-label.is-cancelled{background:#ff3b30}.payment-disclosure{margin:12px 0 0;color:rgba(0,0,0,.5);font-size:11px;line-height:15px}.appointment-actions{margin-top:40px}.action-button,.popup-action{width:100%;height:48px;border:1px solid #dadadc;border-radius:8px;background:transparent;font-size:13px;font-weight:600;cursor:pointer}.action-button+.action-button{margin-top:8px}.action-button.danger{color:#ff3b30}.schedule-another{border-color:transparent;background:#000;color:#fff}.popup-layer{position:absolute;z-index:20;inset:0;pointer-events:none}.popup-backdrop{position:absolute;inset:0;background:#000;opacity:0;transition:opacity .15s}.popup-container{position:absolute;right:0;bottom:0;left:0;max-height:calc(100% - 36px);padding:24px 16px 16px;overflow:auto;border-radius:16px 16px 0 0;background:#f7f7f7;box-shadow:0 12px 32px rgba(0,0,0,.16);transform:translateY(100%);transition:transform .15s}.popup-layer.is-open{pointer-events:auto}.popup-layer.is-open .popup-backdrop{opacity:.25}.popup-layer.is-open .popup-container{transform:translateY(0)}.popup-close{position:absolute;top:10px;right:6px;display:grid;width:44px;height:44px;place-items:center;border:0;background:transparent;color:#616163;cursor:pointer}.popup-close svg{width:24px;height:24px}.popup-container h2{margin:8px 32px 8px 0;font-family:"SF Pro Display",Roboto,sans-serif;font-size:20px;line-height:24px}.popup-container>p{margin:0;padding-right:16px;color:rgba(0,0,0,.5);font-size:15px;line-height:20px}.popup-action{margin-top:40px}.popup-action+.popup-action{margin-top:12px}.popup-action.danger{border-color:transparent;background:#ff3b30;color:#fff}.popup-container [role=status]{min-height:18px;margin:12px 0 0;color:#616163}@keyframes reservation-icon-in{from{transform:scale(0)}to{transform:scale(1)}}@media(max-width:375px){.reservation-widget{max-width:none}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;transition-duration:.01ms!important}}</style>`

export const renderBookingConfirmationView = (confirmation: Confirmation) => {
  const locale = confirmation.locale
  const copy = (key: string) => translateBookingMessage(locale, key)
  const snapshot = confirmation.snapshot
  const isGroup = confirmation.appointments.length > 1
  const isCancelled = confirmation.appointments.some(
    (appointment) => appointment.status === 'cancelled'
  )
  const customerFirstName =
    snapshot.customerDetails.name.trim().split(/\s+/)[0] ??
    snapshot.customerDetails.name
  const headingKey = isCancelled
    ? isGroup
      ? 'reservation.heading_group_cancelled'
      : 'reservation.heading_cancelled'
    : isGroup
      ? 'reservation.heading_group'
      : 'reservation.heading'
  const heading = copy(headingKey).replace('{name}', customerFirstName)
  const status = copy(`status.appointment_${confirmation.status}`)
  const at = copy('label.appointment_at')
  const calendarButton = (
    kind: 'apple' | 'google' | 'yahoo',
    label: string,
    startsAt: string,
    endsAt: string
  ) =>
    `<button type="button" data-testid="btn:calendar:${kind}" data-calendar-kind="${kind}" data-calendar-start="${escapeHtml(startsAt)}" data-calendar-end="${escapeHtml(endsAt)}" aria-label="${label}">${calendarIcon(kind)}</button>`
  const appointmentCards = confirmation.appointments
    .map((appointment) => {
      const appointmentSnapshot = appointment.snapshot
      const primaryService =
        appointmentSnapshot.services.find((service) => service.role === 'primary') ??
        appointmentSnapshot.services[0]
      const additionalServices = appointmentSnapshot.services.filter(
        (service) => service.role === 'additional'
      )
      const servicesTotal = appointmentSnapshot.services.reduce(
        (total, service) => total + service.priceMinor,
        0
      )
      const showServicePrice =
        additionalServices.length > 0 ||
        appointmentSnapshot.totalMinor !== servicesTotal
      const confirmationCode = appointment.id
        .replace(/^apt_/, '')
        .slice(-8)
        .toUpperCase()
      const time = reservationDateTime(
        locale,
        appointment.startsAt,
        appointmentSnapshot.merchantTimezone,
        at
      )
      // Legacy Reservation treats a partly cancelled order as one cancelled
      // presentation and suppresses confirmation controls for every card.
      const appointmentCancelled = isCancelled
      return `<section data-testid="container:orderApptGroup" class="order-appointment"><div data-testid="container:groupAppt" class="appointment-card"><div class="provider-avatar">${escapeHtml(initials(appointmentSnapshot.assignedProvider.displayName))}</div><strong data-testid="text:barberName" class="provider-name">${escapeHtml(appointmentSnapshot.assignedProvider.displayName)}</strong><strong data-testid="text:barberTotal" class="appointment-total">${legacyCurrency(locale, appointmentSnapshot.totalMinor, appointmentSnapshot.currency)}</strong><span data-testid="text:serviceName" class="service-name">${primaryService ? escapeHtml(primaryService.name) : ''}</span><span data-testid="text:servicePrice" class="service-price">${showServicePrice && primaryService ? legacyCurrency(locale, primaryService.priceMinor, primaryService.currency) : ''}</span><span data-testid="text:customerName" class="customer-name">${escapeHtml(appointmentSnapshot.customerDetails.name)}</span>${additionalServices.length ? `<div class="service-addons">${additionalServices.map((service) => `<div class="service-addon"><span>+ ${escapeHtml(service.name)}</span><span>${legacyCurrency(locale, service.priceMinor, service.currency)}</span></div>`).join('')}</div>` : ''}</div><div class="breakdown">${appointmentCancelled ? '' : `<div class="breakdown-row"><span>${escapeHtml(copy('reservation.confirmation_code'))}</span><strong data-testid="text:confirmationCode" class="confirmation-code">${escapeHtml(confirmationCode)}</strong></div>`}<div class="breakdown-row"><span>${escapeHtml(copy('label.duration'))}</span><span data-testid="text:duration">${appointmentSnapshot.durationMinutes} min</span></div><div class="breakdown-row"><span>${escapeHtml(copy('label.time'))}</span>${!isGroup && !appointmentCancelled ? `<button type="button" data-testid="btn:time" class="appointment-time is-clickable" data-reschedule-path="/appointments/${encodeURIComponent(appointment.id)}/reschedule">${escapeHtml(time)}</button>` : `<time data-testid="btn:time" class="appointment-time" datetime="${escapeHtml(appointment.startsAt)}">${escapeHtml(time)}</time>`}</div></div>${appointmentCancelled ? '' : `<div class="calendar"><p>${escapeHtml(copy('reservation.add_to_calendar'))}</p><div class="calendar-actions">${calendarButton('apple', 'iCalendar', appointment.startsAt, appointment.endsAt)}${calendarButton('google', 'Google Calendar', appointment.startsAt, appointment.endsAt)}${calendarButton('yahoo', 'Yahoo Calendar', appointment.startsAt, appointment.endsAt)}</div></div>`}${!isGroup ? `<hr class="divider"><div class="order-total"><strong>${escapeHtml(copy('reservation.total'))}</strong><strong data-testid="text:total">${legacyCurrency(locale, appointmentSnapshot.totalMinor, appointmentSnapshot.currency)}</strong></div><button type="button" data-testid="unfold:taxes-n-fees" class="taxes-toggle">${escapeHtml(copy('reservation.including_taxes'))}<svg viewBox="0 0 9 16" aria-hidden="true"><path d="m1 1 7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button>` : ''}</section>`
    })
    .join('')
  const groupTotal = confirmation.appointments.reduce(
    (total, appointment) => total + appointment.snapshot.totalMinor,
    0
  )
  const groupSummary = isGroup
    ? `<div class="group-total"><strong>${escapeHtml(copy('reservation.total'))}</strong><strong data-testid="text:total">${legacyCurrency(locale, groupTotal, snapshot.currency)}</strong></div>`
    : ''
  const shopAddress = confirmation.shop.addressLines?.join(', ') ?? ''
  const directionsQuery = confirmation.shop.coordinates
    ? `${confirmation.shop.coordinates.latitude},${confirmation.shop.coordinates.longitude}`
    : shopAddress
  const coverPhotoUrl = safeCssImageUrl(confirmation.shop.coverPhotoUrl)
  const coverStyle = coverPhotoUrl
    ? ` style="background-image:url('${escapeHtml(coverPhotoUrl)}')"`
    : ''
  const shop = `<section class="shop-marker"><div class="shop-cover${coverStyle ? '' : ' is-placeholder'}"${coverStyle}><span class="shop-pin"></span></div><div class="shop-copy"><strong data-testid="text:shopName">${escapeHtml(confirmation.shop.publicName)}</strong>${shopAddress ? `<span data-testid="text:shopAddress">${escapeHtml(shopAddress)}</span>` : ''}${directionsQuery ? `<button type="button" data-testid="btn:getDirections" class="directions" data-directions-query="${escapeHtml(directionsQuery)}">${escapeHtml(copy('reservation.get_directions'))}</button>` : ''}</div></section>`
  const cancelMinutes = snapshot.cancellationPolicy?.cancellableUntilMinutesBeforeStart
  const cancelLead = cancelMinutes
    ? (() => {
        const hours = Math.floor(cancelMinutes / 60)
        const minutes = cancelMinutes % 60
        const hourCopy =
          hours === 1
            ? copy('reservation.lead_hour')
            : copy('reservation.lead_hours').replace('{count}', String(hours))
        const minuteCopy =
          minutes === 1
            ? copy('reservation.lead_minute')
            : copy('reservation.lead_minutes').replace('{count}', String(minutes))
        if (!hours) return minuteCopy
        if (!minutes) return hourCopy
        return `${hourCopy} ${minuteCopy}`
      })()
    : ''
  const cancelDisclosureCopy = cancelMinutes
    ? copy(
        isGroup
          ? 'reservation.pay_in_person_disclaimer_group'
          : 'reservation.pay_in_person_disclaimer'
      ).replace('{lead}', cancelLead)
    : ''
  const cancelDisclosure = cancelMinutes
    ? `<p class="payment-disclosure">${cancelDisclosureCopy.split('<br/>').map(escapeHtml).join('<br>')}</p>`
    : ''
  const payment =
    snapshot.checkoutPath === 'pay_in_person'
      ? `<section class="payment-info"><div class="payment-title">${payInPersonIcon}<strong data-testid="text:payInPerson">${escapeHtml(copy('reservation.pay_in_person'))}</strong><span data-testid="text:${isCancelled ? 'canceledStatus' : 'paidStatus'}" class="payment-label${isCancelled ? ' is-cancelled' : ''}">${escapeHtml(copy(isCancelled ? 'reservation.cancelled' : 'reservation.pending_payment'))}</span></div>${cancelDisclosure}</section>`
      : ''
  const scheduled = confirmation.appointments.every(
    (appointment) => appointment.status === 'scheduled'
  )
  const cancelPath = isGroup
    ? '/cancel'
    : `/appointments/${encodeURIComponent(confirmation.appointments[0]?.id ?? '')}/cancel`
  const scheduleAnother =
    isCancelled && !isGroup
      ? `<section class="schedule-another-wrapper"><button type="button" data-testid="btn:scheduleAnother" class="action-button schedule-another" data-book-again>${escapeHtml(copy('reservation.schedule_another'))}</button></section>`
      : ''
  const actions = scheduled
    ? `<section class="appointment-actions">${isGroup ? '' : `<button type="button" data-testid="btn:reschedule" class="action-button" data-reschedule-path="/appointments/${encodeURIComponent(confirmation.appointments[0]!.id)}/reschedule">${escapeHtml(copy('reservation.reschedule'))}</button>`}<button type="button" data-testid="btn:cancel" class="action-button danger" data-popup-open="cancel">${escapeHtml(copy('reservation.cancel'))}</button></section>`
    : ''
  const popup = `<div data-testid="reservation-popup-root" class="popup-layer" aria-hidden="true"><div class="popup-backdrop" data-popup-close></div><section role="dialog" aria-modal="true" aria-labelledby="cancel-popup-title" data-testid="popup:cancelAppointment" class="popup-container"><button type="button" class="popup-close" data-popup-close aria-label="${escapeHtml(copy('action.close'))}">${closeIcon}</button><h2 id="cancel-popup-title">${escapeHtml(copy('reservation.cancel_title'))}</h2><p>${escapeHtml(copy('reservation.cancel_copy'))}</p><button type="button" data-testid="button:confirmCancel" class="popup-action danger" data-cancel-path="${cancelPath}">${escapeHtml(copy('reservation.cancel_confirm'))}</button><button type="button" data-testid="button:discardCancel" class="popup-action" data-popup-close>${escapeHtml(copy('reservation.cancel_keep'))}</button><p role="status" aria-live="polite"></p></section></div>`
  const script = `<script>(function(){var root=document.querySelector('[data-testid="reservation-popup-root"]');var openButton=document.querySelector('[data-popup-open="cancel"]');function closePopup(){root&&root.classList.remove('is-open');root&&root.setAttribute('aria-hidden','true');openButton&&openButton.focus({preventScroll:true})}openButton&&openButton.addEventListener('click',function(){root&&root.classList.add('is-open');root&&root.setAttribute('aria-hidden','false')});root&&root.querySelectorAll('[data-popup-close]').forEach(function(button){button.addEventListener('click',closePopup)});document.addEventListener('keydown',function(event){if(event.key==='Escape')closePopup()});var scrollable=document.querySelector('[data-testid="container:scrollable"]');scrollable&&scrollable.addEventListener('scroll',function(){document.querySelector('[data-testid="container:title"]')?.classList.toggle('is-scrolled',scrollable.scrollTop>0)},{passive:true});document.querySelectorAll('[data-calendar-kind]').forEach(function(button){button.addEventListener('click',function(){var start=button.dataset.calendarStart;var end=button.dataset.calendarEnd;var title=${inlineScriptJson(confirmation.shop.publicName)};var compact=function(value){return value.replace(/[-:]/g,'').replace('.000','')};var kind=button.dataset.calendarKind;var url=kind==='google'?'https://calendar.google.com/calendar/render?action=TEMPLATE&text='+encodeURIComponent(title)+'&dates='+compact(start)+'/'+compact(end):kind==='yahoo'?'https://calendar.yahoo.com/?v=60&title='+encodeURIComponent(title)+'&st='+compact(start)+'&et='+compact(end):'data:text/calendar;charset=utf-8,'+encodeURIComponent('BEGIN:VCALENDAR\\nVERSION:2.0\\nBEGIN:VEVENT\\nDTSTART:'+compact(start)+'\\nDTEND:'+compact(end)+'\\nSUMMARY:'+title+'\\nEND:VEVENT\\nEND:VCALENDAR');window.open(url,'_blank','noopener,noreferrer')})});document.querySelectorAll('[data-directions-query]').forEach(function(button){button.addEventListener('click',function(){window.open('https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(button.dataset.directionsQuery),'_blank','noopener,noreferrer')})});document.querySelectorAll('[data-reschedule-path]').forEach(function(button){button.addEventListener('click',async function(){button.disabled=true;try{var bytes=crypto.getRandomValues(new Uint8Array(32));var capability=Array.from(bytes,function(byte){return byte.toString(16).padStart(2,'0')}).join('');var response=await fetch(location.pathname+button.dataset.reschedulePath,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'begin',capability:capability,expiresAt:new Date(Date.now()+900000).toISOString()})});if(!response.ok)throw new Error();var result=await response.json();var base=location.pathname.split('/booking/confirmations/')[0];location.href=base+'/booking?booking='+encodeURIComponent(result.bookingSessionId)}catch(error){button.disabled=false}})});document.querySelectorAll('[data-book-again]').forEach(function(button){button.addEventListener('click',function(){location.href=location.pathname.split('/booking/confirmations/')[0]+'/booking'})});root&&root.querySelectorAll('[data-cancel-path]').forEach(function(button){button.addEventListener('click',async function(){button.disabled=true;var status=root.querySelector('[role=status]');try{var response=await fetch(location.pathname+button.dataset.cancelPath,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idempotencyKey:'cancel-'+crypto.randomUUID(),reason:'customer_requested'})});if(!response.ok)throw new Error();status.textContent=${inlineScriptJson(copy('confirmation.cancelled'))};location.reload()}catch(error){button.disabled=false;status.textContent=${inlineScriptJson(copy('confirmation.cancel_failed'))}}})})})()</script>`
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(copy('title.appointment_confirmation'))}</title>${styles}</head><body><main class="reservation-widget"><header data-testid="container:title" class="reservation-title"><div class="reservation-title-content">${successIcon(isCancelled)}<h1 data-testid="text:apptConfirmationTitle">${escapeHtml(heading)}</h1></div><span class="reservation-status">${escapeHtml(status)}</span></header><div data-testid="container:scrollable" class="reservation-content">${appointmentCards}${groupSummary}${scheduleAnother}${shop}<hr class="reservation-divider">${payment}${actions}</div>${popup}</main>${script}</body></html>`
}
