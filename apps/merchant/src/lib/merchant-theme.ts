export type MerchantTheme = 'light' | 'dark' | 'system'
export type MerchantTimeTheme = 'morning' | 'afternoon' | 'evening' | 'night'

export const merchantThemeStorageKey = 'merchant-theme'
export const merchantThemeChangeEvent = 'merchant-theme-change'
export const merchantTimeThemeSurfaceColors = {
  morning: 'rgb(248 250 252)',
  afternoon: 'rgb(224 242 254)',
  evening: 'rgb(255 247 237)',
  night: 'rgb(17 23 32)'
} as const satisfies Record<MerchantTimeTheme, string>

export function merchantTimeThemeForHour(hour: number): MerchantTimeTheme {
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 20) return 'evening'
  return 'night'
}

export const merchantThemeBootScript = `(() => {
  try {
    const root = document.documentElement;
    const saved = localStorage.getItem('${merchantThemeStorageKey}');
    const theme = saved === 'light' || saved === 'dark' ? saved : 'system';
    const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    root.classList.toggle('dark', dark);
    root.classList.toggle('light', !dark);
    const hour = new Date().getHours();
    const timeTheme = hour >= 5 && hour < 11
      ? 'morning'
      : hour >= 11 && hour < 17
        ? 'afternoon'
        : hour >= 17 && hour < 20
          ? 'evening'
          : 'night';
    const surface = ${JSON.stringify(merchantTimeThemeSurfaceColors)}[timeTheme];
    root.dataset.merchantTimeTheme = timeTheme;
    root.style.backgroundColor = surface;
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.content = surface;
    });
  } catch {}
})();`

export function applyMerchantTheme(theme: MerchantTheme) {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.classList.toggle('light', !dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

export function applyMerchantTimeTheme(date = new Date()) {
  const timeTheme = merchantTimeThemeForHour(date.getHours())
  const surface = merchantTimeThemeSurfaceColors[timeTheme]
  document.documentElement.dataset.merchantTimeTheme = timeTheme
  document.documentElement.style.backgroundColor = surface
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => {
      meta.content = surface
    })
}

export function readStoredMerchantTheme(): MerchantTheme {
  const stored = localStorage.getItem(merchantThemeStorageKey)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}
