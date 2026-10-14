import { type DeploymentSettings } from './infra/deployment-settings.ts'

/** Public deployment choices. Credential values belong in the operator shell. */
const settings: DeploymentSettings = {
  production: {
    branch: 'master',
    reviewers: [],
    variables: {
      PRIVACY_CONTROLLER_NAME: 'Martin Brandhaug',
      PRIVACY_CONTACT_EMAIL: 'martin@brandhaug.net'
    },
    secrets: []
  }
}

export default settings
