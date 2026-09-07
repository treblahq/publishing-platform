import { describe, expect, it, vi } from 'vitest';
import { fetchWebShell } from './shell.js';

describe('web shell fetch', () => {
  it('caches the immutable route shell at the edge for five minutes', async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response('shell')));

    await fetchWebShell('author', 'https://pages.example', fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      new URL('/route-indexes/authors/', 'https://pages.example'),
      { cf: { cacheEverything: true, cacheTtl: 300 } },
    );
  });

  it('selects the shell route for every web entity kind', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn((url: URL) => {
      urls.push(url.pathname);
      return Promise.resolve(new Response('shell'));
    });

    await fetchWebShell('job', 'https://pages.example', fetcher);
    await fetchWebShell('author', 'https://pages.example', fetcher);
    await fetchWebShell('community', 'https://pages.example', fetcher);

    expect(urls).toEqual(['/jobs/', '/route-indexes/authors/', '/route-indexes/communities/']);
  });
});
