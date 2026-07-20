import * as stylex from '@stylexjs/stylex'

export const staticPageStyles = stylex.create({
  page: {
    display: 'grid',
    minHeight: '100dvh',
    placeItems: 'center',
    padding: 24,
    backgroundColor: '#f7f7f8',
    backgroundImage:
      'linear-gradient(to right, rgb(226 227 231 / 55%) 1px, transparent 1px), linear-gradient(to bottom, rgb(226 227 231 / 55%) 1px, transparent 1px)',
    backgroundSize: '24px 24px'
  },
  card: {
    width: '100%',
    maxWidth: 448,
    padding: 32,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e3e7',
    backgroundColor: '#ffffff'
  },
  narrow: {
    maxWidth: 384,
    textAlign: 'center'
  },
  eyebrow: {
    margin: 0,
    color: '#3566cf',
    fontSize: 12,
    fontWeight: 650
  },
  mono: {
    fontFamily: 'ui-monospace, monospace'
  },
  title: {
    marginTop: 8,
    marginBottom: 0,
    fontSize: 24,
    fontWeight: 650,
    letterSpacing: '-0.02em'
  },
  narrowTitle: {
    fontSize: 20
  },
  copy: {
    marginTop: 12,
    marginBottom: 0,
    color: '#747983',
    fontSize: 14,
    lineHeight: '24px'
  },
  link: {
    display: 'inline-flex',
    height: 38,
    alignItems: 'center',
    marginTop: 24,
    paddingInline: 16,
    borderRadius: 6,
    backgroundColor: {
      default: '#4f7ee8',
      ':hover': '#3c68c9'
    },
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 650,
    textDecoration: 'none'
  }
})
