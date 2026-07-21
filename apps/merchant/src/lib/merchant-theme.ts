export type MerchantTheme = 'light' | 'dark' | 'system'

export const merchantThemeStorageKey = 'merchant-theme'
export const merchantThemeChangeEvent = 'merchant-theme-change'

export const merchantThemeBootScript = `(() => {
  try {
    const saved = localStorage.getItem('${merchantThemeStorageKey}');
    const theme = saved === 'light' || saved === 'dark' ? saved : 'system';
    const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('light', !dark);
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

export function readStoredMerchantTheme(): MerchantTheme {
  const stored = localStorage.getItem(merchantThemeStorageKey)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}
