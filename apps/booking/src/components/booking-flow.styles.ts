import * as stylex from '@stylexjs/stylex'

const interactiveBackground = {
  default: '#ffffff',
  ':hover': '#f2f4f8'
} as const

export const styles = stylex.create({
  app: {
    minHeight: '100dvh',
    paddingBottom: 96,
    backgroundColor: '#f7f7f8'
  },
  widget: {
    width: '100%',
    maxWidth: 375,
    minHeight: '100dvh',
    marginInline: 'auto',
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e3e7',
    backgroundColor: '#f7f7f8'
  },
  header: {
    position: 'sticky',
    top: 0,
    zIndex: 20,
    display: 'flex',
    minHeight: 68,
    alignItems: 'flex-start',
    gap: 12,
    paddingBlock: 20,
    paddingInline: 16,
    backgroundColor: 'rgb(247 247 248 / 94%)',
    backdropFilter: 'blur(12px)'
  },
  title: {
    minWidth: 0,
    flex: 1,
    margin: 0,
    fontSize: 18,
    fontWeight: 650,
    lineHeight: '24px',
    letterSpacing: '-0.02em'
  },
  iconButton: {
    display: 'grid',
    width: 48,
    height: 48,
    flexShrink: 0,
    placeItems: 'center',
    padding: 0,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e3e7',
    borderRadius: 999,
    backgroundColor: '#ffffff',
    color: '#292929'
  },
  backButton: {
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    color: '#747983'
  },
  hidden: {
    visibility: 'hidden'
  },
  icon16: {
    width: 16,
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
  main: {
    paddingTop: 4,
    paddingRight: 16,
    paddingBottom: 32,
    paddingLeft: 16
  },
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
    gap: 12
  },
  providerCard: {
    display: 'flex',
    minHeight: 184,
    flexDirection: 'column',
    alignItems: 'center',
    paddingBlock: 20,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: {
      default: '#e2e3e7',
      ':hover': '#4f7ee8'
    },
    borderRadius: 16,
    backgroundColor: interactiveBackground,
    color: '#292929',
    textAlign: 'center'
  },
  avatar: {
    display: 'grid',
    width: 64,
    height: 64,
    placeItems: 'center',
    borderRadius: 8,
    backgroundColor: '#eff0f3',
    color: '#616773',
    fontSize: 13,
    fontWeight: 650
  },
  providerName: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: 650,
    lineHeight: '20px'
  },
  mutedSmall: {
    marginTop: 4,
    color: '#747983',
    fontSize: 12,
    lineHeight: '16px'
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
    bottom: 16,
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
    padding: 16,
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
