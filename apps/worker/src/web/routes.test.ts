import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const manifest = {
  kind: 'job' as const, id: 'gh_123', revision: 'r1', status: 'active' as const,
  title: 'Platform & Reliability Engineer', summary: 'Build safely', canonicalPath: '/jobs/gh_123',
  contentSha256: 'a'.repeat(64), objectKey: 'entities/openings/job/gh_123/r1/a.json',
};

let runtime: Miniflare | undefined;
beforeAll(async () => {
  const bundle = await build({
    stdin: { resolveDir: import.meta.dirname, contents: `
      import { handleWebEntityRequest } from './routes.ts';
      export default { async fetch(request) {
        const fixture = await request.json();
        const calls = [];
        const bytes = new TextEncoder().encode(fixture.shell ?? '<html><head><title>Generic</title></head><body></body></html>');
        const chunkSize = fixture.chunkSize ?? bytes.length;
        let offset = 0;
        const shell = new Response(new ReadableStream({ pull(controller) {
          if (offset >= bytes.length) { controller.close(); return; }
          controller.enqueue(bytes.slice(offset, offset + chunkSize)); offset += chunkSize;
        } }), { status: fixture.shellStatus ?? 200, headers: { 'content-type': 'text/html' } });
        if (fixture.forbidBuffering) {
          shell.text = () => { throw new Error('Whole-shell text() is forbidden'); };
          shell.arrayBuffer = () => { throw new Error('Whole-shell arrayBuffer() is forbidden'); };
        }
        try {
          const response = await handleWebEntityRequest(new Request('https://worker.test' + fixture.path), {
            find: async (kind, id) => { calls.push(['find', kind, id]); return fixture.manifest; },
            objectExists: async (key) => { calls.push(['objectExists', key]); return fixture.objectExists ?? true; },
            getShell: async (kind) => { calls.push(['getShell', kind]); return shell; },
            canonicalBaseUrl: 'https://openings.dev',
          });
          response.headers.set('x-test-calls', JSON.stringify(calls));
          return response;
        } catch (error) { return new Response(error.message, { status: 599 }); }
      } };`, loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023',
  });
  const script = bundle.outputFiles[0]?.text;
  if (!script) throw new Error('Native route test bundle is missing');
  runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script, compatibilityDate: '2026-09-09', cf: false,
    outboundService: () => { throw new Error('Outbound network is forbidden in route tests'); } }));
  await runtime.ready;
});
afterAll(async () => { await runtime?.dispose(); });

function render(overrides: Record<string, unknown> = {}) {
  if (!runtime) throw new Error('Native route test runtime is missing');
  return runtime.dispatchFetch('https://native.test', { method: 'POST', body: JSON.stringify({
    path: '/web/openings/jobs/gh_123', manifest, ...overrides,
  }) });
}

describe('public web entity routes in native workerd', () => {
  it('does not leak another entity social metadata or structured data from the shared shell', async () => {
    const response = await render({ shell: `<html><head><title>Template</title>
      <meta property="og:image" content="https://openings.dev/jobs/other/opengraph-image.png">
      <meta property='og:description' content='Other job summary'>
      <meta name="twitter:title" content="Other job title">
      <meta name="twitter:image" content="https://openings.dev/jobs/other/opengraph-image.png">
      <meta property="og:image:alt" content="Other job image">
      <script type="application/ld+json">{"@type":"JobPosting","title":"Other job title"}</script>
      </head><body><script src="/app.js"></script></body></html>` });
    const html = await response.text();
    expect(html).not.toContain('Other job');
    expect(html).not.toContain('/jobs/other/');
    expect(html).not.toContain('JobPosting');
    expect(html).toContain('<meta property="og:description" content="Build safely">');
    expect(html).toContain('<meta name="twitter:title" content="Platform &amp; Reliability Engineer">');
    expect(html).toContain('<script src="/app.js"></script>');
  });

  it('renders exact metadata into the bounded shell', async () => {
    const response = await render({ shell: `<html><head><title>Generic</title>
      <link rel="canonical" href="https://openings.dev/jobs/">
      <meta property="og:title" content="Generic">
      <meta property="og:url" content="https://openings.dev/">
      <meta name="description" content="Generic"></head><body></body></html>` });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.headers.get('x-test-calls') ?? '[]')).toContainEqual(['objectExists', manifest.objectKey]);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, follow');
    const html = await response.text();
    expect(html).toContain('Platform &amp; Reliability Engineer');
    expect(html).toContain('https://openings.dev/jobs/gh_123');
    expect(html).toContain('application/json');
    expect(html).not.toContain('content="Generic"');
    expect(html.match(/rel="canonical"/gu)).toHaveLength(1);
    expect(html.match(/property="og:title"/gu)).toHaveLength(1);
  });

  it('returns 404 for an inactive manifest', async () => {
    const response = await render({ manifest: null, path: '/web/openings/jobs/missing' });
    expect(response.status).toBe(404);
    expect(JSON.parse(response.headers.get('x-test-calls') ?? '[]')).toEqual([['find', 'job', 'missing']]);
  });

  it('returns 404 when the active manifest object is missing', async () => {
    const response = await render({ objectExists: false });
    expect(response.status).toBe(404);
    expect(JSON.parse(response.headers.get('x-test-calls') ?? '[]')).toEqual([
      ['find', 'job', 'gh_123'], ['objectExists', manifest.objectKey],
    ]);
  });

  it('streams a shell whose text and arrayBuffer methods throw', async () => {
    const response = await render({ forbidBuffering: true, chunkSize: 3 });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>Platform &amp; Reliability Engineer | openings.dev</title>');
  });

  it.each([1, 2, 7, 31])('isolates metadata split across %i-byte stream chunks and preserves bootstrap bytes', async (chunkSize) => {
    const bootstrap = `<script nonce="original">self.__next_f.push([1,"<meta property='og:title' content='bootstrap string'>ação 😀"])</script>`;
    const response = await render({ forbidBuffering: true, chunkSize, shell: `<html><head>
      <TITLE class="old">Stale title</TITLE><title>Second stale title</title>
      <LINK REL="alternate canonical" href="/stale-canonical">
      <link href='/second-stale-canonical' rel=canonical>
      <META NAME="TWITTER:IMAGE" CONTENT="stale-twitter">
      <meta content="stale-og" PROPERTY=og:image><meta name="description" content="stale-description">
      <script TYPE='APPLICATION/LD+JSON'>{"staleStructured":true}</script>
      <meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/app.css">
      </head><body><main>Visible ação 😀 &amp; content</main>
      <svg><title>Accessible graphic title</title></svg>${bootstrap}<script src="/app.js" async></script>
      <script id="publishing-entity" type="application/json">{"revision":"stale-marker"}</script>
      <script type="application/ld+json">{"staleBodyStructured":true}</script></body></html>` });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).not.toMatch(/Stale title|Second stale title|stale-canonical|stale-twitter|stale-og|stale-description|staleStructured|stale-marker|staleBodyStructured/u);
    expect(html).toContain(bootstrap);
    expect(html).toContain('<main>Visible ação 😀 &amp; content</main>');
    expect(html).toContain('<svg><title>Accessible graphic title</title></svg>');
    expect(html).toContain('<meta name="viewport" content="width=device-width">');
    expect(html).toContain('<link rel="stylesheet" href="/app.css">');
    expect(html).toContain('<script src="/app.js" async></script>');
    expect(html.match(/id="publishing-entity"/gu)).toHaveLength(1);
    expect(html.match(/rel="canonical"/gu)).toHaveLength(1);
    expect(html.match(/<title>Platform &amp; Reliability Engineer \| openings.dev<\/title>/gu)).toHaveLength(1);
  });

  it('escapes hostile entity metadata, canonical attributes and the revision JSON marker', async () => {
    const hostile = { ...manifest, title: `ação & "</title><script>alert('title')</script>`,
      summary: `"'><img src=x onerror=alert('summary')> & safe`,
      revision: `r1</script><script>alert("revision")</script>`,
      canonicalPath: '/jobs/gh_123?x="quoted"&next=<script>',
    };
    const response = await render({ manifest: hostile, forbidBuffering: true, chunkSize: 1 });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-publishing-revision')).toBe(hostile.revision);
    const html = await response.text();
    expect(html).toContain('ação &amp; &quot;&lt;/title&gt;&lt;script&gt;alert(&#39;title&#39;)&lt;/script&gt;');
    expect(html).toContain('&quot;&#39;&gt;&lt;img src=x onerror=alert(&#39;summary&#39;)&gt; &amp; safe');
    expect(html).toContain('href="https://openings.dev/jobs/gh_123?x=%22quoted%22&amp;next=%3Cscript%3E"');
    expect(html).not.toContain('<script>alert(');
    expect(html).not.toContain('<img src=x');
    const json = /<script type="application\/json" id="publishing-entity">(.*?)<\/script>/u.exec(html)?.[1];
    expect(json).toBeDefined();
    expect(json).toContain('\\u003c/script>');
    expect(JSON.parse(json ?? '')).toEqual({ revision: hostile.revision, contentSha256: hostile.contentSha256 });
  });

  it('does not retain or invent descriptions when the selected entity has no summary', async () => {
    const response = await render({ manifest: { ...manifest, summary: undefined }, forbidBuffering: true,
      shell: `<html><head><title>Old</title><meta name="description" content="old">
      <meta property="og:description" content="old"><meta name="twitter:description" content="old"></head><body></body></html>` });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).not.toContain('description');
    expect(html).toContain('<meta property="og:title" content="Platform &amp; Reliability Engineer">');
  });

  it('inserts metadata and the identity marker once despite duplicate head and body tags', async () => {
    const response = await render({ forbidBuffering: true, chunkSize: 2,
      shell: '<html><head><title>One</title></head><head><title>Two</title></head><body>One</body><body>Two</body></html>' });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html.match(/rel="canonical"/gu)).toHaveLength(1);
    expect(html.match(/property="og:title"/gu)).toHaveLength(1);
    expect(html.match(/id="publishing-entity"/gu)).toHaveLength(1);
    expect(html).not.toContain('<title>One</title>');
    expect(html).not.toContain('<title>Two</title>');
  });

  it.each([
    ['job', 'gh_123', '/web/openings/jobs/gh_123', '/jobs/gh_123'],
    ['author', 'alice', '/web/openings/authors/alice', '/authors/alice'],
    ['author', 'alice', '/web/openings/users/alice', '/authors/alice'],
    ['community', 'tech/jobs', '/web/openings/communities/tech/jobs', '/communities/tech/jobs'],
    ['community', 'tech/jobs', '/web/openings/community/tech/jobs', '/communities/tech/jobs'],
  ])('retains lookup and headers for %s at %s (%s)', async (kind, id, path, canonicalPath) => {
    const response = await render({ path, manifest: { ...manifest, kind, id, canonicalPath }, forbidBuffering: true });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.headers.get('x-test-calls') ?? '[]')).toEqual([
      ['find', kind, id], ['objectExists', manifest.objectKey], ['getShell', kind],
    ]);
    expect(response.headers.get('cache-control')).toBe('public, max-age=60, stale-while-revalidate=300');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, follow');
    expect(response.headers.get('x-publishing-revision')).toBe('r1');
    expect(await response.text()).toContain(`href="https://openings.dev${canonicalPath}"`);
  });

  it('returns 503 for an unavailable shell without reading its body', async () => {
    const response = await render({ shellStatus: 500, forbidBuffering: true });
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('Web shell unavailable');
    expect(JSON.parse(response.headers.get('x-test-calls') ?? '[]')).toEqual([
      ['find', 'job', 'gh_123'], ['objectExists', manifest.objectKey], ['getShell', 'job'],
    ]);
  });

  it('rejects an unsupported route before lookup or shell fetching', async () => {
    const response = await render({ path: '/web/openings/unknown/test' });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
    expect(JSON.parse(response.headers.get('x-test-calls') ?? '[]')).toEqual([]);
  });
});
