import * as stylex from '@stylexjs/stylex'
import { bookingTheme } from '../presentation/booking-theme.stylex.ts'

const interactiveBackground = {
  default: '#ffffff',
  ':hover': '#f2f4f8'
} as const

export const styles = stylex.create({
  widget: {
    position: 'relative',
    display: 'flex',
    width: '100%',
    maxWidth: 375,
    height: '100dvh',
    flexDirection: 'column',
    marginInline: 'auto',
    overflow: 'hidden',
    backgroundColor: '#f7f7f7'
  },
  processingOverlay: {
    position: 'absolute',
    zIndex: bookingTheme.layerProcessing,
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    backgroundColor: 'rgb(247 247 247 / 85%)',
    color: '#000000',
    backdropFilter: 'blur(4px)'
  },
  header: {
    position: 'sticky',
    zIndex: bookingTheme.layerChrome,
    display: 'flex',
    boxSizing: 'border-box',
    paddingTop: bookingTheme.space6,
    paddingBottom: bookingTheme.space6,
    paddingInline: bookingTheme.space4,
    backgroundColor: 'transparent',
    color: 'inherit',
    transitionProperty: 'background-color',
    transitionDuration: bookingTheme.motionPage
  },
  headerScrolled: {
    backgroundColor: 'rgb(247 247 247 / 85%)',
    backdropFilter: 'blur(4px)'
  },
  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 600,
    lineHeight: '24px',
    letterSpacing: '0.75px'
  },
  iconButton: {
    display: 'grid',
    width: 24,
    height: 24,
    flexShrink: 0,
    placeItems: 'center',
    padding: 0,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#dedee2',
    borderRadius: 999,
    backgroundColor: 'transparent',
    color: '#000000'
  },
  backButton: {
    opacity: 0.3,
    marginRight: -2,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    color: '#747983',
    transform: 'translate(-8px, 1px)'
  },
  titleActions: {
    position: 'absolute',
    top: bookingTheme.space5,
    right: bookingTheme.space4,
    zIndex: bookingTheme.layerChrome,
    display: 'flex',
    gap: bookingTheme.space2
  },
  icon16: {
    width: 16,
    height: 16
  },
  backIcon: {
    width: 9,
    height: 16
  },
  icon20: {
    width: 20,
    height: 20
  },
  icon24: {
    width: 24,
    height: 24
  },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap'
  },
  main: {
    height: '100%',
    overflowX: 'hidden',
    overflowY: 'auto',
    paddingTop: 0,
    paddingRight: 16,
    paddingBottom: 32,
    paddingLeft: 16,
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
    '::-webkit-scrollbar': { display: 'none' }
  },
  routeLayer: {
    position: 'absolute',
    zIndex: bookingTheme.layerContent,
    display: 'flex',
    width: '100%',
    height: '100%',
    overflowY: 'auto'
  },
  scrollableFrame: {
    position: 'relative',
    width: '100%',
    flex: 1,
    overflow: 'hidden'
  },
  scrollOrigin: { width: '100%', height: 0 },
  contentOffset: { paddingTop: bookingTheme.space18 },
  checkoutSurface: {
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: '#e2e3e7',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: '#ffffff'
  },
  gridTwo: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    columnGap: 11,
    rowGap: 12
  },
  providerCard: {
    position: 'relative',
    display: 'flex',
    width: '100%',
    boxSizing: 'border-box',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    overflow: 'hidden',
    paddingTop: 23,
    paddingRight: 23,
    paddingBottom: 22,
    paddingLeft: 23,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: {
      default: '#dadadc',
      ':hover': '#e1e1e1'
    },
    borderRadius: 16,
    backgroundColor: '#f7f7f7',
    color: '#000000',
    textAlign: 'center',
    userSelect: 'none',
    cursor: 'pointer',
    transitionProperty: 'border-color, background-color, box-shadow',
    transitionDuration: '150ms'
  },
  providerCardSelected: {
    borderColor: bookingTheme.colorPrimary,
    backgroundColor: bookingTheme.colorPrimary,
    color: bookingTheme.colorPrimaryFont
  },
  providerCardBusy: { pointerEvents: 'none' },
  providerCardDisabled: { opacity: 0.32, pointerEvents: 'none' },
  avatar: {
    display: 'grid',
    width: 64,
    height: 64,
    placeItems: 'center',
    borderRadius: 8,
    backgroundColor: '#e0e0e0',
    color: '#616163',
    fontSize: 17,
    fontWeight: 400
  },
  providerName: {
    marginTop: 16,
    marginBottom: 0,
    fontFamily: bookingTheme.fontText,
    fontSize: 17,
    fontWeight: 600,
    lineHeight: '22px',
    letterSpacing: '-0.408px'
  },
  providerNameEllipsis: {
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  providerDivider: {
    width: 30,
    height: 1,
    marginTop: 18,
    backgroundColor: '#dadadc'
  },
  providerAvailability: {
    marginTop: 21,
    marginRight: -24,
    marginBottom: 0,
    marginLeft: -24,
    color: '#616163',
    fontSize: 13,
    lineHeight: '18px',
    textAlign: 'center',
    textTransform: 'capitalize'
  },
  providerAvailabilitySelected: { color: 'inherit' },
  mutedSmall: {
    marginTop: 4,
    color: '#616163',
    fontSize: 13,
    lineHeight: '18px'
  },
  locationActions: {
    display: 'flex',
    height: 32,
    alignItems: 'center'
  },
  locationAction: {
    display: 'inline-flex',
    height: 32,
    alignItems: 'center',
    gap: 6,
    marginRight: 12,
    paddingInline: 19,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#dadadc',
    borderRadius: 15,
    backgroundColor: 'transparent',
    color: '#000000',
    fontSize: 12,
    fontWeight: 600,
    lineHeight: '28px',
    textTransform: 'uppercase'
  },
  locationList: { marginTop: 16 },
  locationSearch: {
    display: 'flex',
    height: 40,
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#dadadc',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    color: '#616163'
  },
  locationSearchInput: {
    minWidth: 0,
    flex: 1,
    padding: 0,
    borderWidth: 0,
    outline: 'none',
    backgroundColor: 'transparent',
    color: '#000000',
    font: 'inherit',
    fontSize: 16
  },
  locationCard: {
    display: 'flex',
    width: '100%',
    minHeight: 147,
    marginBottom: 12,
    alignItems: 'flex-start',
    paddingTop: 19,
    paddingRight: 23,
    paddingBottom: 19,
    paddingLeft: 20,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: '#dadadc', ':hover': '#e1e1e1' },
    borderRadius: 16,
    backgroundColor: '#f7f7f7',
    color: '#616163',
    textAlign: 'left',
    transitionProperty: 'border-color, background-color, box-shadow',
    transitionDuration: '150ms'
  },
  locationImage: {
    display: 'block',
    width: 107,
    height: 107,
    flexShrink: 0,
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: '#e0e0e0'
  },
  locationPlaceholder: {
    width: 32,
    height: 32,
    marginTop: 37,
    marginLeft: 37,
    color: '#8e8e93'
  },
  locationCopy: {
    display: 'flex',
    minWidth: 0,
    height: 107,
    flex: 1,
    flexDirection: 'column',
    marginLeft: 24
  },
  locationName: {
    overflow: 'hidden',
    color: '#000000',
    fontSize: 17,
    fontWeight: 600,
    lineHeight: '22px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  locationAddress: {
    color: '#616163',
    fontSize: 13,
    lineHeight: '18px'
  },
  locationRule: {
    width: 30,
    marginTop: 'auto',
    marginBottom: 10,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: '#c7c7cc'
  },
  locationEmpty: {
    marginTop: 48,
    color: '#616163',
    fontSize: 13,
    lineHeight: '18px',
    textAlign: 'center'
  },
  categoryButton: {
    display: 'flex',
    width: '100%',
    height: 48,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingInline: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e3e7',
    borderRadius: 8,
    backgroundColor: interactiveBackground,
    color: '#292929',
    fontSize: 14
  },
  serviceGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 12,
    marginTop: 16
  },
  serviceCard: {
    position: 'relative',
    minHeight: 124,
    padding: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: {
      default: '#e2e3e7',
      ':hover': '#4f7ee8'
    },
    borderRadius: 16,
    backgroundColor: interactiveBackground,
    color: '#292929',
    textAlign: 'left'
  },
  selectedService: {
    width: 'calc(50% - 6px)',
    borderColor: '#4f7ee8',
    backgroundColor: '#4f7ee8',
    color: '#ffffff'
  },
  selectedAddon: {
    borderColor: '#4f7ee8',
    backgroundColor: '#edf3ff'
  },
  serviceName: {
    display: 'block',
    fontSize: 14,
    fontWeight: 650,
    lineHeight: '20px'
  },
  serviceDuration: {
    display: 'block',
    marginTop: 4,
    color: '#747983',
    fontSize: 12
  },
  selectedServiceDuration: {
    color: 'rgb(255 255 255 / 76%)'
  },
  pricePill: {
    position: 'absolute',
    right: 0,
    bottom: 12,
    paddingBlock: 4,
    paddingInline: 12,
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
    backgroundColor: '#eff0f3',
    fontFamily: 'Geist Mono, ui-monospace, monospace',
    fontSize: 12
  },
  selectedPricePill: {
    backgroundColor: 'rgb(255 255 255 / 16%)'
  },
  selectionMark: {
    position: 'absolute',
    top: -8,
    right: -8,
    display: 'grid',
    width: 28,
    height: 28,
    placeItems: 'center',
    borderRadius: 999,
    backgroundColor: '#292929',
    color: '#ffffff'
  },
  sectionTitle: {
    marginTop: 28,
    marginBottom: 0,
    fontSize: 20,
    fontWeight: 650,
    letterSpacing: '-0.02em'
  },
  month: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600
  },
  dateGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
    gap: 8,
    marginTop: 16
  },
  calendarControls: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: 8
  },
  dateCell: {
    textAlign: 'center'
  },
  dateButton: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: '#292929'
  },
  dateCircle: {
    display: 'grid',
    width: 36,
    height: 36,
    marginInline: 'auto',
    placeItems: 'center',
    borderRadius: 999,
    backgroundColor: '#eff0f3',
    fontSize: 12,
    fontWeight: 650
  },
  activeDate: {
    backgroundColor: '#292929',
    color: '#ffffff',
    outlineWidth: 1,
    outlineStyle: 'solid',
    outlineColor: '#292929',
    outlineOffset: 2
  },
  dayLabel: {
    display: 'block',
    marginTop: 8,
    color: '#747983',
    fontSize: 12
  },
  dayHeading: {
    marginTop: 32,
    marginBottom: 0,
    fontSize: 14,
    fontWeight: 600
  },
  timeGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 8,
    marginTop: 16
  },
  timeButton: {
    height: 48,
    paddingInline: 8,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: {
      default: '#e2e3e7',
      ':hover': '#4f7ee8'
    },
    borderRadius: 12,
    backgroundColor: interactiveBackground,
    color: '#292929',
    fontFamily: 'Geist Mono, ui-monospace, monospace',
    fontSize: 12,
    fontWeight: 650
  },
  selectedTime: {
    borderColor: '#4f7ee8',
    backgroundColor: '#4f7ee8',
    color: '#ffffff'
  },
  selectedTimeFeedback: {
    marginTop: 20,
    color: '#4f7ee8',
    fontSize: 12,
    fontWeight: 650,
    textAlign: 'center'
  },
  fieldGrid: {
    display: 'grid',
    gap: 16
  },
  label: {
    display: 'block'
  },
  labelText: {
    display: 'block',
    marginBottom: 8,
    fontSize: 12,
    fontWeight: 600
  },
  input: {
    width: '100%',
    height: 42,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#d7d9df',
    borderRadius: 6,
    backgroundColor: '#ffffff',
    color: '#292929',
    fontSize: 14
  },
  privacy: {
    display: 'flex',
    gap: 8,
    margin: 0,
    color: '#747983',
    fontSize: 12,
    lineHeight: '20px'
  },
  checkoutChoices: {
    display: 'grid',
    gap: 12
  },
  checkoutChoice: {
    display: 'flex',
    gap: 14,
    alignItems: 'flex-start',
    padding: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: {
      default: '#e2e3e7',
      ':hover': '#4f7ee8'
    },
    borderRadius: 8,
    backgroundColor: interactiveBackground,
    color: '#292929',
    textAlign: 'left'
  },
  selectedChoice: {
    borderColor: '#4f7ee8',
    backgroundColor: '#edf3ff'
  },
  choiceIcon: {
    display: 'grid',
    width: 40,
    height: 40,
    flexShrink: 0,
    placeItems: 'center',
    borderRadius: 6,
    backgroundColor: '#eff0f3',
    color: '#616773'
  },
  selectedChoiceIcon: {
    backgroundColor: '#4f7ee8',
    color: '#ffffff'
  },
  choiceCopy: {
    minWidth: 0,
    flex: 1
  },
  choiceTitleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    fontSize: 14,
    fontWeight: 650
  },
  choiceDescription: {
    display: 'block',
    marginTop: 4,
    color: '#747983',
    fontSize: 12,
    lineHeight: '18px'
  },
  inlineActions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 32,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: '#e2e3e7'
  },
  textButton: {
    minHeight: 44,
    height: 'auto',
    paddingBlock: 8,
    paddingInline: 12,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: '#292929',
    fontSize: 14,
    fontWeight: 600,
    overflowWrap: 'anywhere'
  },
  primaryButton: {
    display: 'inline-flex',
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingInline: 20,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: {
      default: '#4f7ee8',
      ':hover': '#3c68c9',
      ':disabled': '#b8c8ee'
    },
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 650
  },
  orderBar: {
    position: 'fixed',
    bottom: 'max(16px, env(safe-area-inset-bottom))',
    left: '50%',
    zIndex: 30,
    display: 'flex',
    width: 'calc(100% - 24px)',
    maxWidth: 351,
    height: 60,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingInline: 20,
    transform: 'translateX(-50%)',
    borderWidth: 0,
    borderRadius: 16,
    backgroundColor: '#292929',
    color: '#ffffff',
    boxShadow: '0 14px 30px rgb(0 0 0 / 20%)',
    fontSize: 14,
    fontWeight: 650
  },
  mono: {
    fontFamily: 'Geist Mono, ui-monospace, monospace'
  },
  drawer: {
    position: 'fixed',
    insetBlock: 0,
    left: '50%',
    zIndex: 40,
    display: 'flex',
    width: '100%',
    maxWidth: 375,
    flexDirection: 'column',
    paddingTop: 'max(16px, env(safe-area-inset-top))',
    paddingRight: 'max(16px, env(safe-area-inset-right))',
    paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
    paddingLeft: 'max(16px, env(safe-area-inset-left))',
    transform: 'translateX(-50%)',
    backgroundColor: '#292929',
    color: '#ffffff',
    boxShadow: '0 20px 50px rgb(0 0 0 / 28%)'
  },
  drawerHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16
  },
  drawerTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 650
  },
  drawerSubtitle: {
    marginTop: 4,
    marginBottom: 0,
    color: 'rgb(255 255 255 / 56%)',
    fontSize: 12
  },
  darkIconButton: {
    borderColor: 'rgb(255 255 255 / 20%)',
    backgroundColor: 'transparent',
    color: '#ffffff'
  },
  orderCard: {
    marginTop: 24,
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgb(255 255 255 / 10%)'
  },
  rowBetween: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12
  },
  orderProvider: {
    margin: 0,
    fontSize: 14,
    fontWeight: 650
  },
  orderMuted: {
    marginTop: 4,
    marginBottom: 0,
    color: 'rgb(255 255 255 / 56%)',
    fontSize: 12
  },
  orderLine: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: 'rgb(255 255 255 / 12%)',
    color: 'rgb(255 255 255 / 64%)',
    fontSize: 12
  },
  drawerFooter: {
    marginTop: 'auto'
  },
  subtotal: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    fontWeight: 650
  },
  drawerButton: {
    width: '100%',
    height: 48
  },
  alert: {
    marginBottom: 20,
    padding: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e9a9a4',
    borderRadius: 8,
    backgroundColor: '#fff3f2'
  },
  alertTitle: {
    margin: 0,
    color: '#b33a32',
    fontSize: 14,
    fontWeight: 650
  },
  alertCopy: {
    marginTop: 4,
    marginBottom: 0,
    color: '#747983',
    fontSize: 12
  },
  empty: {
    display: 'grid',
    minHeight: 256,
    placeItems: 'center',
    padding: 32,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cdd0d7',
    backgroundColor: '#f2f3f5',
    textAlign: 'center'
  },
  emptyIcon: {
    display: 'grid',
    width: 44,
    height: 44,
    marginInline: 'auto',
    placeItems: 'center',
    borderRadius: 999,
    backgroundColor: '#e7e8ec'
  },
  emptyTitle: {
    marginTop: 16,
    marginBottom: 0,
    fontSize: 16,
    fontWeight: 650
  },
  emptyCopy: {
    marginTop: 8,
    marginBottom: 0,
    color: '#747983',
    fontSize: 14,
    lineHeight: '22px'
  },
  secondaryButton: {
    height: 38,
    marginTop: 20,
    paddingInline: 16,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: '#e7e8ec',
    color: '#292929',
    fontSize: 13,
    fontWeight: 650
  },
  confirmation: {
    maxWidth: 343,
    marginInline: 'auto'
  },
  receipt: {
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#eff0f3'
  },
  receiptHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 12
  },
  receiptAvatar: {
    display: 'grid',
    width: 40,
    height: 40,
    placeItems: 'center',
    borderRadius: 6,
    backgroundColor: '#ffffff',
    fontSize: 12,
    fontWeight: 650
  },
  receiptIdentity: {
    minWidth: 0,
    flex: 1
  },
  receiptName: {
    display: 'block',
    fontSize: 14,
    fontWeight: 650
  },
  receiptMeta: {
    display: 'block',
    color: '#747983',
    fontSize: 12
  },
  receiptPrice: {
    textAlign: 'right'
  },
  receiptRows: {
    display: 'grid',
    gap: 16,
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: '#d7d9df'
  },
  receiptRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    fontSize: 14
  },
  receiptLabel: {
    color: '#747983'
  },
  primaryText: {
    color: '#3566cf'
  },
  calendarLabel: {
    marginTop: 20,
    marginBottom: 0,
    color: '#747983',
    fontSize: 14
  },
  calendarGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 8,
    marginTop: 12
  },
  calendarButton: {
    height: 40,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#d7d9df',
    borderRadius: 6,
    backgroundColor: interactiveBackground,
    fontSize: 12,
    fontWeight: 650
  },
  totalRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: '#d7d9df',
    fontWeight: 650
  },
  taxCopy: {
    marginTop: 4,
    marginBottom: 0,
    color: '#747983',
    fontSize: 12
  },
  merchantBlock: {
    display: 'flex',
    gap: 12,
    marginTop: 20,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: '#e2e3e7'
  },
  mapIcon: {
    display: 'grid',
    width: 64,
    height: 64,
    flexShrink: 0,
    placeItems: 'center',
    borderRadius: 6,
    backgroundColor: '#eff0f3',
    color: '#4f7ee8'
  },
  address: {
    display: 'block',
    marginTop: 4,
    color: '#747983',
    fontSize: 12
  },
  directions: {
    display: 'block',
    marginTop: 12,
    color: '#3566cf',
    fontSize: 14
  },
  paymentRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginTop: 20
  },
  badge: {
    paddingBlock: 4,
    paddingInline: 8,
    borderRadius: 6,
    backgroundColor: '#e4f1f5',
    color: '#225d71',
    fontSize: 11,
    fontWeight: 650
  },
  explanation: {
    marginTop: 24,
    marginBottom: 0,
    color: '#747983',
    fontSize: 12,
    lineHeight: '20px'
  },
  toolbar: {
    position: 'fixed',
    top: {
      default: 12,
      '@media (max-width: 640px)': 'auto'
    },
    right: 12,
    bottom: {
      default: 'auto',
      '@media (max-width: 640px)': 84
    },
    zIndex: 25,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingBlock: 8,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e3e7',
    borderRadius: 6,
    backgroundColor: 'rgb(255 255 255 / 95%)',
    boxShadow: '0 4px 14px rgb(0 0 0 / 8%)',
    backdropFilter: 'blur(12px)',
    fontSize: 12
  },
  toolbarLabel: {
    color: {
      default: '#747983',
      '@media (max-width: 640px)': 'transparent'
    },
    width: {
      default: 'auto',
      '@media (max-width: 640px)': 0
    },
    overflow: 'hidden',
    fontWeight: 600
  },
  select: {
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: '#292929',
    fontSize: 12,
    fontWeight: 600,
    outline: 'none'
  },
  devState: {
    position: 'fixed',
    bottom: 16,
    left: 16,
    zIndex: 25,
    display: {
      default: 'block',
      '@media (max-width: 760px)': 'none'
    },
    width: 310,
    padding: 10,
    backgroundColor: '#292929',
    color: '#ffffff',
    boxShadow: '0 8px 20px rgb(0 0 0 / 14%)',
    fontFamily: 'Geist Mono, ui-monospace, monospace',
    fontSize: 10
  }
})
