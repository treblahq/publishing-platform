function parse(value: unknown): Record<string, string> {
  if (typeof value !== 'string' || value.length === 0) throw new Error('Producer secrets are required');
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Invalid producer secrets');
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.some(([, secret]) => typeof secret !== 'string' || secret.length === 0)) {
    throw new Error('Invalid producer secret');
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

export function loadProducerSecrets(primary: unknown, social: unknown): Readonly<Record<string, string>> {
  const existing = parse(primary);
  if (social === undefined) return existing;
  const additional = parse(social);
  if (Object.keys(additional).some(id => Object.hasOwn(existing, id))) {
    throw new Error('Social producer credentials must not override an existing client');
  }
  return { ...existing, ...additional };
}
