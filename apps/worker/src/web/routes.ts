import type { WebEntityKind } from '@trebla/publishing';
import type { StoredWebManifest } from './d1-entity-stores.js';

interface Dependencies {
  find(kind: WebEntityKind, id: string): Promise<StoredWebManifest | null>;
  objectExists(key: string): Promise<boolean>;
  getShell(kind: WebEntityKind): Promise<Response>;
  canonicalBaseUrl: string;
}

export async function handleWebEntityRequest(request: Request, dependencies: Dependencies): Promise<Response> {
  const route = parseRoute(new URL(request.url).pathname);
  if (!route) return new Response('Not found', { status: 404 });
  const manifest = await dependencies.find(route.kind, route.id);
  if (!manifest || !await dependencies.objectExists(manifest.objectKey)) return new Response('Not found', { status: 404 });
  const shell = await dependencies.getShell(route.kind);
  if (!shell.ok) return new Response('Web shell unavailable', { status: 503 });
  const canonicalUrl = new URL(manifest.canonicalPath, dependencies.canonicalBaseUrl).toString();
  const metadata = `${title(manifest.title)}<link rel="canonical" href="${escapeHtml(canonicalUrl)}">`
    + `<meta property="og:title" content="${escapeHtml(manifest.title)}">`
    + `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">`
    + `<meta name="twitter:card" content="summary">`
    + `<meta name="twitter:title" content="${escapeHtml(manifest.title)}">`
    + (manifest.summary ? `<meta name="description" content="${escapeHtml(manifest.summary)}">`
      + `<meta property="og:description" content="${escapeHtml(manifest.summary)}">`
      + `<meta name="twitter:description" content="${escapeHtml(manifest.summary)}">` : '');
  const entityJson = JSON.stringify({ revision: manifest.revision, contentSha256: manifest.contentSha256 })
    .replaceAll('<', '\\u003c');
  let metadataInserted = false;
  let markerInserted = false;
  // Native parsing removes stale identity without buffering or modifying bootstrap script bytes.
  const transformed = new HTMLRewriter()
    .on('head title', { element(element) { element.remove(); } })
    .on('head', { element(element) {
      if (!metadataInserted) element.append(metadata, { html: true });
      metadataInserted = true;
    } })
    .on('link', { element(element) {
      if (element.getAttribute('rel')?.toLowerCase().split(/\s+/u).includes('canonical')) element.remove();
    } })
    .on('meta', { element(element) {
      const names = [element.getAttribute('name'), element.getAttribute('property')];
      if (names.some((name) => {
        const normalized = name?.toLowerCase().trim();
        return normalized === 'description' || normalized?.startsWith('og:') || normalized?.startsWith('twitter:');
      })) element.remove();
    } })
    .on('script', { element(element) {
      if (element.getAttribute('type')?.trim().toLowerCase() === 'application/ld+json'
        || element.getAttribute('id') === 'publishing-entity') element.remove();
    } })
    .on('body', { element(element) {
      if (!markerInserted) element.append(`<script type="application/json" id="publishing-entity">${entityJson}</script>`, { html: true });
      markerInserted = true;
    } })
    .transform(shell);
  return new Response(transformed.body, { headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'public, max-age=60, stale-while-revalidate=300',
    'x-robots-tag': 'noindex, follow',
    'x-publishing-revision': manifest.revision,
  } });
}

function parseRoute(path: string): { kind: WebEntityKind; id: string } | null {
  const segments = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (segments[0] !== 'web' || !segments[1]) return null;
  const firstId = segments[3];
  if (segments[2] === 'jobs' && segments.length === 4 && firstId) return { kind: 'job', id: firstId };
  if (['authors', 'users'].includes(segments[2] ?? '') && segments.length === 4 && firstId) {
    return { kind: 'author', id: firstId };
  }
  const secondId = segments[4];
  if (['communities', 'community'].includes(segments[2] ?? '') && segments.length === 5) {
    if (firstId && secondId) return { kind: 'community', id: `${firstId}/${secondId}` };
  }
  return null;
}

function title(value: string) { return `<title>${escapeHtml(value)} | openings.dev</title>`; }
function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
