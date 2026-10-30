import { Runtime } from 'foldkit'
import { application } from './program'
import '@fontsource-variable/geist/index.css'
import '@fontsource-variable/geist-mono/index.css'
import '@fontsource-variable/newsreader/index.css'
import '../index.css'

Runtime.hydrate(application(document.querySelector<HTMLElement>('[data-foldkit-app]')))
