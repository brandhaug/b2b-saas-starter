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
      '@media (hover: hover)': { default: '#dadadc', ':hover': '#e1e1e1' }
    },
    borderRadius: 16,
    backgroundColor: {
      default: '#f7f7f7',
      '@media (hover: hover)': { default: '#f7f7f7', ':hover': '#ffffff' }
    },
    boxShadow: {
      default: 'none',
      '@media (hover: hover)': {
        default: 'none',
        ':hover': '0 8px 16px -5px rgba(0, 0, 0, 0.1)'
      }
    },
    color: '#000000',
    textAlign: 'center',
    userSelect: 'none',
    cursor: 'pointer',
    transitionProperty: 'border-color, background-color, box-shadow',
    transitionDuration: '150ms'
  },
  providerCardSelected: {
    borderColor: {
      default: bookingTheme.colorPrimary,
      '@media (hover: hover)': {
        default: bookingTheme.colorPrimary,
        ':hover': bookingTheme.colorPrimary
      }
    },
    backgroundColor: {
      default: bookingTheme.colorPrimary,
      '@media (hover: hover)': {
        default: bookingTheme.colorPrimary,
        ':hover': bookingTheme.colorPrimary
      }
    },
    boxShadow: {
      default: 'none',
      '@media (hover: hover)': { default: 'none', ':hover': 'none' }
    },
    color: bookingTheme.colorPrimaryFont
  },
  providerCardVisible: { overflow: 'visible' },
  providerCardBusy: { pointerEvents: 'none' },
  providerCardDisabled: { opacity: 0.32, pointerEvents: 'none' },
  avatar: {
    position: 'relative',
    width: 64,
    height: 64,
    lineHeight: 0
  },
  avatarReplacement: {
    display: 'flex',
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#e1e1e6',
    color: 'rgba(60, 60, 67, 0.6)'
  },
  avatarReplacementSelected: { color: 'inherit' },
  avatarInitials: {
    display: 'flex',
    margin: 0,
    fontFamily: bookingTheme.fontDisplay,
    fontSize: 20,
    fontWeight: 600,
    lineHeight: '24px',
    letterSpacing: '0.75px'
  },
  anyProviderIcon: {
    width: 38,
    height: 37,
    marginTop: 14
  },
  anyProviderTitle: {
    marginTop: 29,
    marginBottom: 0,
    fontFamily: bookingTheme.fontText,
    fontSize: 17,
    fontWeight: 600,
    lineHeight: '22px',
    letterSpacing: '-0.408px',
    textAlign: 'center'
  },
  anyProviderSubtitle: {
    marginTop: 9,
    marginBottom: 0
  },
  cardSmallText: {
    marginRight: 0,
    marginLeft: 0,
    color: '#616163',
    fontFamily: bookingTheme.fontText,
    fontSize: 13,
    lineHeight: '18px',
    letterSpacing: '-0.078px',
    textAlign: 'center'
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
    minHeight: 36,
    marginTop: 21,
    marginRight: -24,
    marginBottom: 0,
    marginLeft: -24,
    color: '#616163',
    fontFamily: bookingTheme.fontText,
    fontSize: 13,
    lineHeight: '18px',
    letterSpacing: '-0.078px',
    textAlign: 'center',
    textTransform: 'capitalize'
  },
  providerAvailabilitySelected: { color: 'inherit' },
  giftCardIcon: { width: 48, height: 30, marginTop: 17 },
  giftCardTitle: {
    marginTop: 33,
    marginBottom: 0,
    marginLeft: -2,
    fontFamily: bookingTheme.fontText,
    fontSize: 17,
    fontWeight: 600,
    lineHeight: '20px',
    letterSpacing: '-0.408px',
    textAlign: 'center'
  },
  giftCardSubtitle: { marginTop: 9, marginBottom: 12 },
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
    backgroundColor: 'transparent',
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
  categorySpaceTaker: {
    position: 'relative',
    width: '100%',
    height: 46
  },
  categorySelect: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 999,
    width: '100%',
    height: 46,
    boxSizing: 'border-box',
    overflow: 'hidden',
    padding: 0,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#dadadc',
    borderRadius: 8,
    backgroundColor: 'transparent',
    color: 'rgb(28 28 30)',
    outline: 'none',
    textAlign: 'left',
    userSelect: 'none',
    cursor: 'pointer',
    transitionProperty: 'background-color',
    transitionDuration: '100ms',
    transitionTimingFunction: 'linear',
    transitionDelay: '100ms'
  },
  categorySelectCollapsed: {
    backgroundColor: {
      default: 'transparent',
      '@media (hover: hover)': {
        default: 'transparent',
        ':hover': '#ffffff'
      }
    },
    boxShadow: {
      default: 'none',
      '@media (hover: hover)': {
        default: 'none',
        ':hover': '0 8px 16px -5px rgb(0 0 0 / 10%)'
      }
    }
  },
  categorySelectChosen: {
    borderColor: {
      default: '#ebebeb',
      '@media (hover: hover)': {
        default: '#ebebeb',
        ':hover': '#dadadc'
      }
    },
    backgroundColor: {
      default: '#ebebeb',
      '@media (hover: hover)': {
        default: '#ebebeb',
        ':hover': '#ffffff'
      }
    },
    boxShadow: {
      default: 'none',
      '@media (hover: hover)': {
        default: 'none',
        ':hover': '0 8px 16px -5px rgb(0 0 0 / 10%)'
      }
    }
  },
  categorySelectExpanded: {
    borderColor: '#e1e1e1',
    backgroundColor: '#ffffff',
    boxShadow: '0 12px 24px 0 rgb(0 0 0 / 10%)',
    transitionDuration: '0ms',
    transitionDelay: '0ms'
  },
  categorySelectedText: {
    overflow: 'hidden',
    margin: 0,
    paddingTop: 13,
    paddingRight: 16,
    paddingBottom: 13,
    paddingLeft: 16,
    fontFamily: bookingTheme.fontText,
    fontSize: 15,
    fontWeight: 400,
    lineHeight: '20px',
    letterSpacing: '-0.24px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  categorySelectedTextChosen: { fontWeight: 600 },
  categoryOption: {
    display: 'block',
    width: '100%',
    paddingTop: 10,
    paddingRight: 15,
    paddingBottom: 10,
    paddingLeft: 15,
    borderWidth: 0,
    backgroundColor: {
      default: 'transparent',
      ':hover': 'rgb(242 242 245)',
      ':focus': 'rgb(242 242 245)'
    },
    textAlign: 'left',
    cursor: 'pointer'
  },
  categoryOptionText: {
    display: 'block',
    overflow: 'hidden',
    margin: 0,
    color: '#616163',
    fontFamily: bookingTheme.fontText,
    fontSize: 15,
    fontWeight: 400,
    lineHeight: '20px',
    letterSpacing: '-0.24px',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  categoryStateArrow: {
    position: 'absolute',
    top: 21,
    right: 17,
    zIndex: 1000,
    width: 12,
    height: 6,
    color: 'rgb(28 28 30)',
    opacity: 0.6,
    cursor: 'pointer',
    transitionProperty: 'transform',
    transitionDuration: {
      default: '150ms',
      '@media (prefers-reduced-motion: reduce)': '0ms'
    }
  },
  categoryStateArrowExpanded: { transform: 'rotate(180deg)' },
  serviceGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    columnGap: 10,
    rowGap: 10,
    marginTop: 16
  },
  serviceGridWithoutCategory: { marginTop: 0 },
  serviceCardSpace: {
    position: 'relative',
    width: '100%',
    height: 125,
    minHeight: 125
  },
  confirmedServiceCardSpace: { width: 166 },
  serviceCard: {
    position: 'absolute',
    zIndex: 1,
    width: '100%',
    minHeight: 125,
    boxSizing: 'border-box',
    overflow: 'visible',
    paddingTop: 15,
    paddingRight: 15,
    paddingBottom: 49,
    paddingLeft: 15,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: {
      default: '#dadadc',
      '@media (hover: hover)': { default: '#dadadc', ':hover': '#e1e1e1' }
    },
    borderRadius: 16,
    backgroundColor: {
      default: '#f7f7f7',
      '@media (hover: hover)': { default: '#f7f7f7', ':hover': '#ffffff' }
    },
    color: '#616163',
    boxShadow: {
      default: 'none',
      '@media (hover: hover)': {
        default: 'none',
        ':hover': '0 8px 16px -5px rgba(0, 0, 0, 0.1)'
      }
    },
    textAlign: 'left',
    userSelect: 'none',
    cursor: 'pointer',
    transitionProperty: 'border-color, background-color, box-shadow',
    transitionDuration: '150ms'
  },
  selectedService: {
    borderColor: bookingTheme.colorPrimary,
    backgroundColor: bookingTheme.colorPrimary,
    backgroundImage: {
      default: 'linear-gradient(transparent, transparent)',
      ':hover': 'linear-gradient(rgb(255 255 255 / 8%), rgb(255 255 255 / 8%))',
      ':active': 'linear-gradient(rgb(255 255 255 / 8%), rgb(255 255 255 / 8%))'
    },
    color: bookingTheme.colorViewOrderText,
    boxShadow: 'none'
  },
  selectedAddon: {
    borderColor: '#e1e1e1',
    backgroundColor: '#ffffff',
    color: '#616163'
  },
  serviceCardBusy: { pointerEvents: 'none' },
  serviceName: {
    width: '100%',
    overflow: 'hidden',
    margin: 0,
    color: '#000000',
    fontFamily: bookingTheme.fontText,
    fontSize: 15,
    fontWeight: 600,
    lineHeight: '20px',
    letterSpacing: '-0.24px',
    overflowWrap: 'break-word',
    maxHeight: 40
  },
  selectedServiceName: { color: bookingTheme.colorPrimaryFont },
  serviceDuration: {
    marginTop: 3,
    marginBottom: 0,
    fontFamily: bookingTheme.fontText,
    fontSize: 13,
    lineHeight: '18px',
    letterSpacing: '-0.078px'
  },
  selectedServiceDuration: {
    color: bookingTheme.colorPrimaryFont
  },
  serviceDescription: {
    width: '100%',
    height: 0,
    overflow: 'hidden',
    opacity: 0
  },
  pricePill: {
    position: 'absolute',
    right: -1,
    bottom: 15,
    margin: 0,
    paddingTop: 4,
    paddingRight: 12,
    paddingBottom: 4,
    paddingLeft: 12,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
    backgroundColor: '#ebebeb',
    color: '#000000',
    fontFamily: bookingTheme.fontText,
    fontSize: 13,
    fontWeight: 600,
    lineHeight: '18px',
    letterSpacing: '-0.078px'
  },
  selectedPricePill: {
    backgroundColor: 'rgb(255 255 255 / 16%)'
  },
  selectedAddonPricePill: {
    backgroundColor: 'rgb(186 186 186 / 50%)',
    color: '#000000'
  },
  selectionMark: {
    position: 'absolute',
    top: -8,
    right: -8,
    display: 'grid',
    width: 30,
    height: 30,
    placeItems: 'center',
    borderRadius: 999,
    backgroundColor: '#000000',
    color: '#ffffff'
  },
  confirmedCheck: { width: 11, height: 8 },
  sectionTitle: {
    marginTop: 24,
    marginBottom: 24,
    fontFamily: bookingTheme.fontDisplay,
    fontSize: 20,
    fontWeight: 600,
    lineHeight: '24px',
    letterSpacing: '0.75px'
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
  orderBarFixed: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    zIndex: 30,
    width: '100%'
  },
  orderBarSafeArea: {
    position: 'absolute',
    bottom: 0,
    display: 'flex',
    width: '100%',
    height: 88,
    boxSizing: 'border-box',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 12,
    paddingRight: 12,
    paddingBottom: 16,
    paddingLeft: 12
  },
  orderBar: {
    display: 'flex',
    width: '100%',
    height: 60,
    boxSizing: 'border-box',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 20,
    paddingLeft: 16,
    borderWidth: 0,
    borderRadius: 16,
    backgroundColor: bookingTheme.colorPrimary,
    color: bookingTheme.colorPrimaryFont,
    boxShadow: '0 8px 16px -5px rgb(0 0 0 / 10%)',
    fontFamily: bookingTheme.fontText,
    fontSize: 17,
    fontWeight: 600,
    lineHeight: '22px',
    letterSpacing: '-0.408px'
  },
  orderBarTotal: {
    opacity: 0.5,
    fontWeight: 400
  },
  mono: {
    fontFamily: 'Geist Mono, ui-monospace, monospace'
  },
  drawer: {
    position: 'absolute',
    right: 0,
    bottom: -1,
    left: 0,
    zIndex: 40,
    display: 'flex',
    width: '100%',
    boxSizing: 'border-box',
    flexDirection: 'column',
    overflow: 'hidden',
    paddingTop: 24,
    paddingRight: 16,
    paddingBottom: 16,
    paddingLeft: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: bookingTheme.colorCart,
    color: '#ffffff',
    boxShadow: '0 -8px 16px rgb(0 0 0 / 3%)'
  },
  drawerHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16
  },
  drawerTitle: {
    margin: 0,
    fontFamily: bookingTheme.fontDisplay,
    fontSize: 20,
    fontWeight: 600,
    lineHeight: '24px',
    letterSpacing: '0.75px'
  },
  drawerSubtitle: {
    marginTop: 4,
    marginBottom: 0,
    color: bookingTheme.colorCartAuxText,
    fontFamily: bookingTheme.fontText,
    fontSize: 13,
    lineHeight: '18px',
    letterSpacing: '-0.078px'
  },
  darkIconButton: {
    borderColor: 'rgb(255 255 255 / 20%)',
    backgroundColor: 'transparent',
    color: '#ffffff'
  },
  drawerClose: {
    position: 'absolute',
    top: 24,
    right: 16,
    width: 32,
    height: 32,
    borderWidth: 0,
    backgroundColor: {
      default: 'transparent',
      ':hover': '#161616',
      ':active': '#161616'
    },
    color: bookingTheme.colorCartAuxText
  },
  drawerCloseBorder: { stroke: bookingTheme.colorCartCloseBorder },
  drawerCloseContent: { fill: bookingTheme.colorCartCloseContent },
  drawerBody: {
    minHeight: 0,
    flex: 1,
    overflowY: 'auto',
    scrollbarWidth: 'none'
  },
  orderCard: {
    marginTop: 24,
    padding: 16,
    borderRadius: 16,
    backgroundColor: bookingTheme.colorCartAppointment
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
