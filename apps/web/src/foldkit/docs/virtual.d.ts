import { type DocMeta, type Heading } from './contracts'

declare const articles: ReadonlyArray<{ readonly meta: DocMeta; readonly html: string; readonly headings: ReadonlyArray<typeof Heading.Type> }>
export default articles
