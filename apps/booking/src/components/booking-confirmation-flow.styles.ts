import * as stylex from '@stylexjs/stylex'
import { bookingTheme } from '../presentation/booking-theme.stylex.ts'

export const confirmationStyles = stylex.create({
  title: {
    position: 'absolute',
    zIndex: 4,
    top: 0,
    right: 0,
    left: 0,
    display: 'flex',
    boxSizing: 'border-box',
    paddingBlock: 24,
    paddingInline: 16,
    backgroundColor: 'transparent',
    transitionProperty: 'background-color',
    transitionDuration: '300ms'
  },
  titleScrolled: {
    backgroundColor: bookingTheme.colorChromeTitle,
    backdropFilter: 'blur(4px)'
  },
  titleContent: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    paddingTop: 8,
    paddingRight: 36
  },
  titleIcon: {
    display: 'block',
    width: 42,
    height: 42,
    flexShrink: 0,
    marginTop: 3,
    animationName: stylex.keyframes({
      from: { transform: 'scale(0)' },
      to: { transform: 'scale(1)' }
    }),
    animationDuration: '300ms',
    animationDelay: '300ms',
    animationFillMode: 'both',
    '@media (prefers-reduced-motion: reduce)': { animationDuration: '0ms' }
  },
  titleText: {
    margin: 0,
    fontFamily: bookingTheme.fontLegacyDisplay,
    fontSize: 20,
    fontWeight: 600,
    lineHeight: '24px',
    letterSpacing: '0.75px'
  },
  visuallyHidden: {
    position: 'absolute',
    overflow: 'hidden',
    width: 1,
    height: 1,
    clip: 'rect(0 0 0 0)'
  },
  contentFrame: {
    position: 'absolute',
    zIndex: 1,
    inset: 0,
    width: '100%',
    height: '100%',
    overflow: 'hidden'
  },
  scrollable: {
    position: 'absolute',
    inset: 0,
    boxSizing: 'border-box',
    overflowX: 'hidden',
    overflowY: 'auto',
    paddingTop: 104,
    paddingRight: 16,
    paddingBottom: 32,
    paddingLeft: 16,
    scrollbarWidth: 'none',
    '::-webkit-scrollbar': { display: 'none' }
  },
  scrollSentinel: { width: '100%', height: 0 },
  orderAppointment: {
    position: 'relative',
    marginBottom: 12,
    paddingBlock: 20,
    paddingInline: 16,
    borderRadius: 8,
    backgroundColor: bookingTheme.colorSystemGray5
  },
  appointmentCard: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column'
  },
  barberAndService: {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: '40px minmax(0, 1fr) auto',
    gridTemplateAreas:
      '"BarberAvatar BarberName TotalPrice" "BarberAvatar ServiceName ServiceName"',
    columnGap: 12,
    rowGap: 3,
    alignItems: 'start'
  },
  avatarWrapper: {
    gridArea: 'BarberAvatar',
    alignSelf: 'center'
  },
  avatar: {
    display: 'flex',
    position: 'relative',
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: bookingTheme.colorChrome,
    color: bookingTheme.colorTertiaryLabel,
    lineHeight: 0
  },
  avatarInitials: {
    margin: 0,
    fontFamily: bookingTheme.fontLegacyDisplay,
    fontSize: 12.5,
    fontWeight: 600,
    lineHeight: '24px',
    letterSpacing: '0.75px'
  },
  barberNameWrapper: {
    display: 'flex',
    gridArea: 'BarberName',
    alignItems: 'center',
    overflow: 'hidden'
  },
  totalPriceWrapper: { gridArea: 'TotalPrice' },
  serviceNameWrapper: {
    display: 'flex',
    gridArea: 'ServiceName'
  },
  serviceLine: {
    display: 'flex',
    flex: 1,
    minWidth: 0,
    justifyContent: 'space-between'
  },
  serviceLabelWrapper: {
    display: 'flex',
    flex: 1,
    minWidth: 0,
    alignItems: 'center'
  },
  primaryText: {
    overflow: 'hidden',
    margin: 0,
    color: bookingTheme.colorPrimaryLabel,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 17,
    fontWeight: 600,
    lineHeight: '22px',
    letterSpacing: '-0.408px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  totalText: { textAlign: 'right' },
  secondaryText: {
    width: '100%',
    maxWidth: 'calc(100% - 1em)',
    overflow: 'hidden',
    margin: 0,
    color: bookingTheme.colorSecondaryLabel,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 15,
    lineHeight: '18px',
    letterSpacing: '-0.24px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  secondaryPrice: {
    width: 'auto',
    maxWidth: 'none',
    flexShrink: 0,
    marginLeft: 4,
    textAlign: 'right'
  },
  serviceAddonsWrapper: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: 16
  },
  serviceAddonsWrapperPopulated: {
    marginTop: 16
  },
  addon: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    color: bookingTheme.colorSecondaryLabel,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 15,
    lineHeight: '18px',
    letterSpacing: '-0.24px'
  },
  serviceTimeWrapper: {
    display: 'flex',
    flexDirection: 'column'
  },
  breakdown: { display: 'grid', gap: 16, marginTop: 23 },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    color: bookingTheme.colorSecondaryLabel,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 15,
    lineHeight: '18px',
    letterSpacing: '-0.24px'
  },
  confirmationCode: {
    paddingBlock: 4,
    paddingInline: 8,
    borderRadius: 4,
    backgroundColor: bookingTheme.colorSystemGray4,
    color: bookingTheme.colorPrimaryLabel
  },
  appointmentTime: {
    maxWidth: '68%',
    overflow: 'hidden',
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: bookingTheme.colorSecondaryLabel,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 15,
    lineHeight: '18px',
    letterSpacing: '-0.24px',
    textAlign: 'right',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  appointmentTimeAction: { color: bookingTheme.colorLink, cursor: 'pointer' },
  calendar: { marginTop: 20 },
  calendarLabel: {
    margin: 0,
    color: bookingTheme.colorSecondaryLabel,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 15,
    lineHeight: '18px',
    letterSpacing: '-0.24px'
  },
  calendarActions: { display: 'flex', gap: 9, marginTop: 12 },
  calendarButton: {
    display: 'flex',
    width: '100%',
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: bookingTheme.colorSystemGray4,
    borderRadius: 8,
    backgroundColor: 'transparent',
    color: bookingTheme.colorPrimaryLabel,
    cursor: 'pointer'
  },
  calendarIcon: { display: 'block', width: 20, height: 16 },
  divider: {
    height: 1,
    marginBlock: 20,
    borderWidth: 0,
    backgroundColor: bookingTheme.colorSystemGray4
  },
  totalRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    color: bookingTheme.colorPrimaryLabel,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 17,
    fontWeight: 600,
    lineHeight: '22px',
    letterSpacing: '-0.408px'
  },
  taxesToggle: {
    marginTop: 2,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    color: bookingTheme.colorSecondaryLabel,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 13,
    lineHeight: '18px',
    letterSpacing: '-0.078px',
    cursor: 'pointer'
  },
  taxesChevron: {
    width: 4,
    height: 7,
    marginLeft: 4,
    transform: 'rotate(-90deg)'
  },
  taxesBreakdown: { marginTop: 10 },
  groupTotal: { marginBlock: 24 },
  scheduleAnotherWrapper: { marginTop: 16 },
  shop: { display: 'flex', marginTop: 24 },
  shopCover: {
    display: 'flex',
    width: 76,
    height: 76,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundPosition: '50% 50%',
    backgroundSize: '248px 248px'
  },
  shopPlaceholder: {
    backgroundImage:
      'repeating-linear-gradient(-45deg, #e1e1e1 0, #e1e1e1 4px, #dadadc 5px, #dadadc 6px)'
  },
  shopPin: {
    width: 16,
    height: 16,
    borderWidth: 3,
    borderStyle: 'solid',
    borderColor: '#ffffff',
    borderRadius: 999,
    backgroundColor: '#0083ff',
    boxShadow: '0 4px 16px rgb(0 0 0 / 24%)'
  },
  shopCopy: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    paddingLeft: 16
  },
  shopName: {
    margin: 0,
    color: bookingTheme.colorPrimaryLabel,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 17,
    fontWeight: 600,
    lineHeight: '22px',
    letterSpacing: '-0.408px'
  },
  shopAddress: {
    marginTop: 2,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    color: bookingTheme.colorSecondaryLabel,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 13,
    lineHeight: '18px',
    letterSpacing: '-0.078px'
  },
  directions: {
    alignSelf: 'flex-start',
    marginTop: 'auto',
    marginRight: 0,
    marginBottom: 2,
    marginLeft: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    cursor: 'pointer'
  },
  directionsText: {
    margin: 0,
    color: bookingTheme.colorLink,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 15,
    lineHeight: '18px',
    letterSpacing: '-0.24px'
  },
  reservationDivider: {
    height: 1,
    marginBlock: 24,
    borderWidth: 0,
    backgroundColor: bookingTheme.colorSystemGray4
  },
  payment: { marginTop: 24 },
  paymentTitle: { display: 'flex', alignItems: 'center' },
  paymentIcon: { display: 'block', width: 38, height: 24 },
  paymentName: {
    marginLeft: 16,
    color: bookingTheme.colorPrimaryLabel,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 17,
    fontWeight: 600,
    lineHeight: '22px',
    letterSpacing: '-0.408px'
  },
  actions: { marginTop: 40 },
  actionButton: {
    width: '100%',
    height: 48,
    padding: 0,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: bookingTheme.colorSystemGray4,
    borderRadius: 8,
    backgroundColor: 'transparent',
    color: bookingTheme.colorPrimaryLabel,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 15,
    fontWeight: 600,
    lineHeight: '20px',
    letterSpacing: '-0.24px',
    cursor: 'pointer',
    ':disabled': { opacity: 0.6, cursor: 'not-allowed' }
  },
  actionSpacing: { marginTop: 8 },
  dangerAction: { color: bookingTheme.colorDanger },
  primaryAction: {
    borderColor: 'transparent',
    backgroundColor: bookingTheme.colorPrimary,
    color: bookingTheme.colorPrimaryFontOnPrimary
  },
  popupMount: { position: 'absolute', zIndex: 20, inset: 0, pointerEvents: 'none' },
  popupMountOpen: { pointerEvents: 'auto' },
  popupHeader: { position: 'relative', paddingBlock: 24, paddingInline: 16 },
  popupTitle: {
    margin: 0,
    paddingRight: 40,
    fontFamily: bookingTheme.fontLegacyDisplay,
    fontSize: 20,
    fontWeight: 600,
    lineHeight: '24px'
  },
  popupClose: {
    position: 'absolute',
    top: 14,
    right: 6,
    display: 'grid',
    width: 44,
    height: 44,
    placeItems: 'center',
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: bookingTheme.colorSecondaryLabel,
    cursor: 'pointer'
  },
  popupCloseIcon: { display: 'block', width: 24, height: 24 },
  popupBody: { paddingRight: 16, paddingBottom: 16, paddingLeft: 16 },
  popupCopy: {
    margin: 0,
    color: bookingTheme.blackA50,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 15,
    lineHeight: '20px'
  },
  popupPrimary: {
    marginTop: 40,
    backgroundColor: bookingTheme.colorDanger,
    color: '#fff'
  },
  popupSecondary: { marginTop: 12 },
  popupStatus: {
    minHeight: 18,
    marginTop: 12,
    marginBottom: 0,
    color: bookingTheme.colorSecondaryLabel,
    fontFamily: bookingTheme.fontLegacyText,
    fontSize: 13
  },
  error: {
    display: 'grid',
    height: '100%',
    placeItems: 'center',
    padding: 24,
    color: bookingTheme.colorPrimaryLabel,
    fontFamily: bookingTheme.fontLegacyText,
    textAlign: 'center'
  }
})
