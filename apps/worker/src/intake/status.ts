import { authenticateRequest, type ProducerClientLoader } from './authenticate.js';

export async function handlePublicationStatusRequest(request: Request, dependencies: {
  now(): Date;
  loadClient: ProducerClientLoader;
  loadStatus(tenant: string, clientId: string, publicationId: string): Promise<unknown>;
}): Promise<Response> {
  const path = new URL(request.url).pathname;
  const match = /^\/v1\/publications\/([a-zA-Z0-9-]{1,128})$/u.exec(path);
  if (request.method !== 'GET' || !match?.[1]) return json({ code: 'NOT_FOUND' }, 404);
  let principal;
  try {
    principal = await authenticateRequest({ method: 'GET', path, body: '',
      headers: Object.fromEntries(request.headers.entries()), now: dependencies.now(),
    }, dependencies.loadClient);
  } catch { return json({ code: 'UNAUTHORIZED' }, 401); }
  const status = await dependencies.loadStatus(principal.tenant, principal.clientId, match[1]);
  return status === null ? json({ code: 'NOT_FOUND' }, 404) : json(status, 200);
}

function json(value: unknown, status: number) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
}
