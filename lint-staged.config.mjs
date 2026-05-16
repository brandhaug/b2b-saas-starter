export default {
  '*.{ts,tsx,js,jsx,json,md,mdx,css}': ['oxfmt --write'],
  '*.{ts,tsx,js,jsx}': ['oxlint --fix']
}
