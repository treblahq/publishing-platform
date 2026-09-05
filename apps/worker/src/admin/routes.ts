export interface AdminDependencies {
  token: string;
  ready(): Promise<unknown>;
  inspect(tenant: string, publicationId: string): Promise<unknown>;
  listDeliveries(tenant: string, state: string | undefined): Promise<unknown>;
  replay(tenant: string, deliveryId: string, reason: string): Promise<unknown>;
  setAdapter(tenant: string, adapter: string, enabled: boolean, reason: string): Promise<unknown>;
}

export async function handleAdminRequest(
  request: Request,
  dependencies: AdminDependencies,
): Promise<Response> {
  if (!authorized(request.headers.get('Authorization'), dependencies.token)) {
    return json({ code: 'UNAUTHORIZED' }, 401);
  }

  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/admin/health/ready') {
    return json(await dependencies.ready());
  }

  const publication = /^\/admin\/publications\/([^/]+)$/u.exec(url.pathname);
  if (request.method === 'GET' && publication?.[1] !== undefined) {
    const tenant = url.searchParams.get('tenant');
    if (tenant === null) return json({ code: 'TENANT_REQUIRED' }, 400);
    return json(await dependencies.inspect(tenant, decodeURIComponent(publication[1])));
  }

  if (request.method === 'GET' && url.pathname === '/admin/deliveries') {
    const tenant = url.searchParams.get('tenant');
    if (tenant === null) return json({ code: 'TENANT_REQUIRED' }, 400);
    return json(await dependencies.listDeliveries(tenant, url.searchParams.get('state') ?? undefined));
  }

  const replay = /^\/admin\/deliveries\/([^/]+)\/replay$/u.exec(url.pathname);
  if (request.method === 'POST' && replay?.[1] !== undefined) {
    const tenant = url.searchParams.get('tenant');
    if (tenant === null) return json({ code: 'TENANT_REQUIRED' }, 400);
    const reason = await readReason(request);
    if (reason === undefined) return json({ code: 'REASON_REQUIRED' }, 400);
    return json(await dependencies.replay(tenant, decodeURIComponent(replay[1]), reason), 202);
  }

  const adapter = /^\/admin\/adapters\/([^/]+)\/([^/]+)\/(pause|resume)$/u.exec(url.pathname);
  if (request.method === 'POST' && adapter?.[1] !== undefined && adapter[2] !== undefined) {
    const reason = await readReason(request);
    if (reason === undefined) return json({ code: 'REASON_REQUIRED' }, 400);
    return json(await dependencies.setAdapter(
      decodeURIComponent(adapter[1]),
      decodeURIComponent(adapter[2]),
      adapter[3] === 'resume',
      reason,
    ));
  }

  return json({ code: 'NOT_FOUND' }, 404);
}

function authorized(header: string | null, expectedToken: string): boolean {
  if (header === null || !header.startsWith('Bearer ') || expectedToken.length === 0) return false;
  const supplied = new TextEncoder().encode(header.slice(7));
  const expected = new TextEncoder().encode(expectedToken);
  let difference = supplied.length ^ expected.length;
  const length = Math.max(supplied.length, expected.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (supplied[index] ?? 0) ^ (expected[index] ?? 0);
  }
  return difference === 0;
}

async function readReason(request: Request): Promise<string | undefined> {
  try {
    const value: unknown = await request.json();
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const reason = (value as Record<string, unknown>).reason;
    return typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : undefined;
  } catch {
    return undefined;
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}
