export const bufferedDevProxyRequest = async (
  request: Request,
  target: URL
): Promise<Request> => {
  const mutation = request.method !== 'GET' && request.method !== 'HEAD'
  return new Request(target, {
    method: request.method,
    headers: request.headers,
    redirect: 'manual',
    ...(mutation ? { body: await request.arrayBuffer() } : {})
  })
}
