import { type Locale } from '@b2b-saas-starter/i18n/locale'

function LocaleFlag({ locale }: { readonly locale: Locale }) {
  return (
    <img
      aria-hidden="true"
      alt=""
      className="h-4 w-6 shrink-0 rounded-sm object-cover"
      draggable="false"
      src={`/flags/${locale === 'nb' ? 'no' : 'us'}.svg`}
    />
  )
}

export { LocaleFlag }
