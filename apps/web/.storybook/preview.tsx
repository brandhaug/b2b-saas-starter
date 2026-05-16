import type { Preview } from '@storybook/react-vite'
import '../src/index.css'

const preview: Preview = {
  parameters: {
    layout: 'centered'
  },
  tags: ['autodocs']
}

export default preview
