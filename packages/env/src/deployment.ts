export const DEPLOYMENT_COMMIT_HEADER = 'x-deployment-commit'
export const DEPLOYMENT_VERSION_HEADER = 'x-deployment-version'

export type DeploymentIdentity = { commit: string | null; version: string | null }

/** Public deployment metadata only. Callers supply values, never an environment bag. */
export function deploymentIdentity(
  commit: string | null | undefined,
  version: string | null | undefined
): DeploymentIdentity {
  const identity: DeploymentIdentity = { commit: null, version: null }
  if (/^[a-f0-9]{40}$/.test(commit ?? '')) {
    identity.commit = commit ?? null
  }
  if (/^[\w.+-]{1,128}$/.test(version ?? '')) {
    identity.version = version ?? null
  }
  return identity
}

export function setDeploymentIdentity(
  response: Response,
  commit: string | null | undefined,
  version: string | null | undefined
): Response {
  const identity = deploymentIdentity(commit, version)
  response.headers.delete(DEPLOYMENT_COMMIT_HEADER)
  response.headers.delete(DEPLOYMENT_VERSION_HEADER)
  if (identity.commit !== null) {
    response.headers.set(DEPLOYMENT_COMMIT_HEADER, identity.commit)
  }
  if (identity.version !== null) {
    response.headers.set(DEPLOYMENT_VERSION_HEADER, identity.version)
  }
  response.headers.set('cache-control', 'no-store')
  return response
}
