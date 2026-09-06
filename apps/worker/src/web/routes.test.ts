import { describe, expect, it } from 'vitest';
import { handleWebEntityRequest } from './routes.js';

const manifest = {
  kind: 'job' as const, id: 'gh_123', revision: 'r1', status: 'active' as const,
  title: 'Platform & Reliability Engineer', summary: 'Build safely', canonicalPath: '/jobs/gh_123',
  contentSha256: 'a'.repeat(64), objectKey: 'entities/openings/job/gh_123/r1/a.json',
};

describe('public web entity routes', () => {
  it('renders exact metadata into the bounded shell', async () => {
    let checkedObjectKey: string | undefined;
    const response = await handleWebEntityRequest(
      new Request('https://worker.test/web/openings/jobs/gh_123'),
      {
        find: () => Promise.resolve(manifest),
        objectExists: (key) => {
          checkedObjectKey = key;
          return Promise.resolve(true);
        },
        getShell: () => Promise.resolve(new Response(`<html><head><title>Generic</title>
          <link rel="canonical" href="https://openings.dev/jobs/">
          <meta property="og:title" content="Generic">
          <meta property="og:url" content="https://openings.dev/">
          <meta name="description" content="Generic"></head><body></body></html>`)),
        canonicalBaseUrl: 'https://openings.dev',
      },
    );
    expect(response.status).toBe(200);
    expect(checkedObjectKey).toBe(manifest.objectKey);
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
    const dependencies = {
      find: () => Promise.resolve(null), objectExists: () => Promise.resolve(false),
      getShell: () => Promise.resolve(new Response('shell')), canonicalBaseUrl: 'https://openings.dev',
    };
    await expect(handleWebEntityRequest(
      new Request('https://worker.test/web/openings/jobs/missing'), dependencies,
    ).then((response) => response.status)).resolves.toBe(404);
  });

  it('returns 404 when the active manifest object is missing', async () => {
    await expect(handleWebEntityRequest(
      new Request('https://worker.test/web/openings/jobs/gh_123'),
      {
        find: () => Promise.resolve(manifest),
        objectExists: () => Promise.resolve(false),
        getShell: () => Promise.resolve(new Response('shell')),
        canonicalBaseUrl: 'https://openings.dev',
      },
    ).then((response) => response.status)).resolves.toBe(404);
  });
});
