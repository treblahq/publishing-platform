import type { WebEntityKind } from '@trebla/publishing';

interface ShellFetchInit {
  cf: { cacheEverything: true; cacheTtl: 300 };
}

type ShellFetcher = (url: URL, init: ShellFetchInit) => Promise<Response>;

export function fetchWebShell(
  kind: WebEntityKind,
  baseUrl: string,
  fetcher = fetch as unknown as ShellFetcher,
): Promise<Response> {
  const path = kind === 'job'
    ? '/route-indexes/jobs/'
    : kind === 'author'
      ? '/route-indexes/authors/'
      : '/route-indexes/communities/';
  return fetcher(new URL(path, baseUrl), {
    cf: { cacheEverything: true, cacheTtl: 300 },
  });
}
