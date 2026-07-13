import * as stylex from '@stylexjs/stylex'
import { useRef, useState } from 'react'
import { BookingVisualAsset } from '../assets/booking-visual-asset.tsx'
import {
  BOOKING_LANGUAGE_NAMES,
  BOOKING_LOCALES,
  type BookingLocale
} from '../localization/booking-localization.ts'
import { useBookingLocalization } from '../localization/booking-localization-provider.tsx'
import { BookingPopupSheet } from '../presentation/booking-primitives.tsx'
import { bookingTheme } from '../presentation/booking-theme.stylex.ts'

const styles = stylex.create({
  trigger: {
    display: 'grid',
    width: 32,
    height: 32,
    placeItems: 'center',
    padding: 0,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: {
      default: bookingTheme.colorCartAuxBorderLight,
      '@media (hover: hover)': {
        default: bookingTheme.colorCartAuxBorderLight,
        ':hover': 'rgb(225 225 225)'
      }
    },
    borderRadius: 16,
    backgroundColor: {
      default: 'transparent',
      '@media (hover: hover)': {
        default: 'transparent',
        ':hover': bookingTheme.colorSurface
      },
      ':active': 'rgb(238 238 238)'
    },
    color: bookingTheme.colorText,
    boxShadow: {
      default: '0 4px 16px -5px rgb(0 0 0 / 0%)',
      '@media (hover: hover)': {
        default: '0 4px 16px -5px rgb(0 0 0 / 0%)',
        ':hover': '0 4px 16px -5px rgb(0 0 0 / 10%)'
      }
    },
    cursor: 'pointer',
    transitionProperty: 'background-color, border-color, box-shadow',
    transitionDuration: '150ms'
  },
  triggerIcon: { width: 10, height: 10 },
  header: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 24,
    paddingRight: 16,
    paddingBottom: 24,
    paddingLeft: 16
  },
  languageControl: { position: 'relative' },
  languageButton: {
    display: 'flex',
    height: 28,
    alignItems: 'center',
    gap: 4,
    paddingRight: 12,
    paddingLeft: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: bookingTheme.colorCartAuxBorderLight,
    borderRadius: 16,
    backgroundColor: bookingTheme.colorSurface,
    color: bookingTheme.colorText,
    fontSize: 12,
    fontWeight: 600,
    lineHeight: '16px',
    cursor: 'pointer'
  },
  globe: { width: 12, height: 12 },
  languageList: {
    position: 'absolute',
    zIndex: 2,
    top: 32,
    left: 0,
    minWidth: 96,
    overflow: 'hidden',
    paddingTop: 8,
    paddingBottom: 8,
    borderWidth: 0.5,
    borderStyle: 'solid',
    borderColor: bookingTheme.colorCartAuxBorderLight,
    borderRadius: 16,
    backgroundColor: bookingTheme.colorSurface,
    boxShadow: '0 8px 16px rgb(0 0 0 / 10%)'
  },
  languageOption: {
    width: '100%',
    paddingTop: 8,
    paddingRight: 16,
    paddingBottom: 8,
    paddingLeft: 16,
    borderWidth: 0,
    backgroundColor: { default: 'transparent', ':hover': bookingTheme.blackA10 },
    color: bookingTheme.colorText,
    fontFamily: bookingTheme.fontText,
    fontSize: 15,
    lineHeight: '18px',
    letterSpacing: '-0.24px',
    textAlign: 'left',
    cursor: 'pointer'
  },
  languageOptionSelected: { fontWeight: bookingTheme.fontWeightSemibold },
  closeButton: {
    display: 'grid',
    width: 28,
    height: 28,
    placeItems: 'center',
    padding: 0,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: {
      default: bookingTheme.colorCartAuxBorderLight,
      '@media (hover: hover)': {
        default: bookingTheme.colorCartAuxBorderLight,
        ':hover': 'rgb(225 225 225)'
      }
    },
    borderRadius: 14,
    backgroundColor: {
      default: bookingTheme.colorSurface,
      ':active': 'rgb(238 238 238)'
    },
    color: bookingTheme.colorText,
    boxShadow: {
      default: '0 4px 16px -5px rgb(0 0 0 / 0%)',
      '@media (hover: hover)': {
        default: '0 4px 16px -5px rgb(0 0 0 / 0%)',
        ':hover': '0 4px 16px -5px rgb(0 0 0 / 10%)'
      }
    },
    cursor: 'pointer',
    transitionProperty: 'background-color, border-color, box-shadow',
    transitionDuration: '150ms'
  },
  closeIcon: { width: 14, height: 14 },
  body: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingTop: 8,
    paddingRight: 16,
    paddingBottom: 32,
    paddingLeft: 16,
    textAlign: 'center'
  },
  accountIcon: {
    display: 'grid',
    width: 72,
    height: 72,
    placeItems: 'center',
    borderRadius: 36,
    color: bookingTheme.colorText
  },
  accountIconSvg: { width: 72, height: 72 },
  title: {
    marginTop: 20,
    marginBottom: 0,
    fontFamily: bookingTheme.fontDisplay,
    fontSize: 20,
    fontWeight: 600,
    lineHeight: '24px',
    letterSpacing: '0.75px'
  },
  subtitle: {
    maxWidth: 280,
    marginTop: 6,
    marginBottom: 0,
    color: bookingTheme.colorTertiaryLabel,
    fontSize: bookingTheme.textFootnote,
    lineHeight: '18px'
  },
  authControls: {
    display: 'grid',
    width: '100%',
    gap: 10,
    marginTop: 28
  },
  authButton: {
    display: 'flex',
    width: '100%',
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingRight: 16,
    paddingLeft: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: bookingTheme.colorCartAuxBorderLight,
    borderRadius: 12,
    backgroundColor: bookingTheme.colorSurface,
    color: bookingTheme.colorText,
    fontSize: bookingTheme.textBody,
    fontWeight: bookingTheme.fontWeightSemibold,
    opacity: 0.45,
    cursor: 'not-allowed'
  },
  authButtonPrimary: {
    borderColor: 'transparent',
    backgroundColor: bookingTheme.colorPrimary,
    color: bookingTheme.colorPrimaryFont
  },
  authProviderIcon: { minWidth: 14, fontSize: 14, lineHeight: '14px' },
  googleIcon: { color: '#4285f4', fontWeight: bookingTheme.fontWeightSemibold },
  footerActions: {
    display: 'flex',
    gap: 16,
    marginTop: 22
  },
  footerButton: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: bookingTheme.colorSecondaryLabel,
    fontSize: bookingTheme.textFootnote,
    opacity: 0.5
  },
  unavailable: {
    marginTop: 16,
    color: bookingTheme.colorTertiaryLabel,
    fontSize: bookingTheme.textCaption,
    lineHeight: '16px'
  }
})

export function BookingWidgetMenu() {
  const { locale, setLocale, message } = useBookingLocalization()
  const [open, setOpen] = useState(false)
  const [languageOpen, setLanguageOpen] = useState(false)
  const [popupTarget, setPopupTarget] = useState<HTMLElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const close = () => {
    setLanguageOpen(false)
    setOpen(false)
  }

  const header = (
    <div {...stylex.props(styles.header)}>
      <div {...stylex.props(styles.languageControl)}>
        <button
          type="button"
          aria-label={`${message('label.language')}: ${BOOKING_LANGUAGE_NAMES[locale]}`}
          aria-expanded={languageOpen}
          data-testid="btn:language-selector"
          onClick={() => setLanguageOpen((value) => !value)}
          {...stylex.props(styles.languageButton)}
        >
          <BookingVisualAsset
            assetRole="language-selector"
            {...stylex.props(styles.globe)}
          />
          <span>{locale.toUpperCase()}</span>
        </button>
        {languageOpen ? (
          <div
            role="menu"
            aria-label={message('label.language')}
            {...stylex.props(styles.languageList)}
          >
            {BOOKING_LOCALES.map((value) => (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={value === locale}
                data-testid={`lang:${value}`}
                onClick={() => {
                  setLocale(value as BookingLocale)
                  setLanguageOpen(false)
                }}
                {...stylex.props(
                  styles.languageOption,
                  value === locale && styles.languageOptionSelected
                )}
              >
                {BOOKING_LANGUAGE_NAMES[value]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={message('action.close_menu')}
        data-testid="btn:closePopup"
        onClick={close}
        {...stylex.props(styles.closeButton)}
      >
        <BookingVisualAsset assetRole="dismiss" {...stylex.props(styles.closeIcon)} />
      </button>
    </div>
  )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={message('label.booking_menu')}
        aria-expanded={open}
        data-testid="btn:menu"
        onClick={() => {
          setPopupTarget(
            triggerRef.current?.closest<HTMLElement>(
              '[data-booking-shell="canonical"]'
            ) ?? document.body
          )
          setOpen((value) => !value)
        }}
        {...stylex.props(styles.trigger)}
      >
        <BookingVisualAsset
          assetRole="navigation-menu"
          {...stylex.props(styles.triggerIcon)}
        />
      </button>
      <BookingPopupSheet
        target={popupTarget}
        open={open}
        label={message('label.booking_menu')}
        onClose={close}
        testId="popup:booking-menu"
        header={header}
      >
        <div {...stylex.props(styles.body)}>
          <div aria-hidden="true" {...stylex.props(styles.accountIcon)}>
            <BookingVisualAsset
              assetRole="sign-in-cta"
              {...stylex.props(styles.accountIconSvg)}
            />
          </div>
          <p {...stylex.props(styles.title)}>{message('menu.sign_in_title')}</p>
          <p {...stylex.props(styles.subtitle)}>{message('menu.sign_in_subtitle')}</p>
          <div {...stylex.props(styles.authControls)}>
            <button
              type="button"
              disabled
              data-testid="btn:useEmail"
              {...stylex.props(styles.authButton, styles.authButtonPrimary)}
            >
              {message('menu.sign_in_email')}
            </button>
            <button
              type="button"
              disabled
              data-testid="btn:useApple"
              {...stylex.props(styles.authButton)}
            >
              <span aria-hidden="true">
                <BookingVisualAsset
                  assetRole="identity-apple"
                  label=""
                  {...stylex.props(styles.authProviderIcon)}
                />
              </span>
              {message('menu.sign_in_apple')}
            </button>
            <button
              type="button"
              disabled
              data-testid="btn:useGoogle"
              {...stylex.props(styles.authButton)}
            >
              <span aria-hidden="true">
                <BookingVisualAsset
                  assetRole="identity-google"
                  label="G"
                  {...stylex.props(styles.authProviderIcon, styles.googleIcon)}
                />
              </span>
              {message('menu.sign_in_google')}
            </button>
          </div>
          <div {...stylex.props(styles.footerActions)}>
            <button
              type="button"
              disabled
              data-testid="btn:createAccount"
              {...stylex.props(styles.footerButton)}
            >
              {message('menu.create_account')}
            </button>
            <button
              type="button"
              disabled
              data-testid="btn:manageChoices"
              {...stylex.props(styles.footerButton)}
            >
              {message('menu.manage_choices')}
            </button>
          </div>
          <p data-state="needs-configuration" {...stylex.props(styles.unavailable)}>
            {message('menu.sign_in_needs_configuration')}
          </p>
        </div>
      </BookingPopupSheet>
    </>
  )
}
