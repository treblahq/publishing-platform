export type AdapterConfigs = Record<string, Record<string, Record<string, unknown>>>;

export function parseAdapterConfigs(value: unknown, oneSignalRestApiKey: unknown, mastodonAccessTokens?: unknown): AdapterConfigs {
  if (typeof value !== 'string' || value.length === 0) return {};
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Invalid adapter configs');
  }
  const configs = structuredClone(parsed) as Record<string, unknown>;
  for (const [tenantId, tenant] of Object.entries(configs)) {
    if (typeof tenant !== 'object' || tenant === null || Array.isArray(tenant)) {
      throw new Error('Invalid tenant adapter configs');
    }
    const mastodon = (tenant as Record<string, unknown>)['social.mastodon'];
    if (mastodon !== undefined) {
      if (typeof mastodon !== 'object' || mastodon === null || Array.isArray(mastodon)) throw new Error('Invalid Mastodon config');
      if (Object.hasOwn(mastodon, 'accessToken')) throw new Error('Mastodon key must not appear in public configuration');
      const secrets: unknown = typeof mastodonAccessTokens === 'string' ? JSON.parse(mastodonAccessTokens) : undefined;
      const token = typeof secrets === 'object' && secrets !== null && !Array.isArray(secrets)
        ? (secrets as Record<string, unknown>)[tenantId] : undefined;
      if (typeof token !== 'string' || token.length === 0) throw new Error('Mastodon Worker secret is required for tenant');
      (mastodon as Record<string, unknown>).accessToken = token;
    }
    const oneSignal = (tenant as Record<string, unknown>)['push.onesignal'];
    if (oneSignal === undefined) continue;
    if (typeof oneSignal !== 'object' || oneSignal === null || Array.isArray(oneSignal)) {
      throw new Error('Invalid OneSignal adapter config');
    }
    const oneSignalConfig = oneSignal as Record<string, unknown>;
    if (Object.hasOwn(oneSignalConfig, 'restApiKey')) {
      throw new Error('OneSignal key must not appear in public configuration');
    }
    if (typeof oneSignalRestApiKey !== 'string' || oneSignalRestApiKey.length === 0) {
      throw new Error('OneSignal Worker secret is required');
    }
    oneSignalConfig.restApiKey = oneSignalRestApiKey;
  }
  return configs as AdapterConfigs;
}
