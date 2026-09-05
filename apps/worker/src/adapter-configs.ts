export type AdapterConfigs = Record<string, Record<string, Record<string, unknown>>>;

export function parseAdapterConfigs(value: unknown, oneSignalRestApiKey: unknown): AdapterConfigs {
  if (typeof value !== 'string' || value.length === 0) return {};
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Invalid adapter configs');
  }
  const configs = structuredClone(parsed) as Record<string, unknown>;
  for (const tenant of Object.values(configs)) {
    if (typeof tenant !== 'object' || tenant === null || Array.isArray(tenant)) {
      throw new Error('Invalid tenant adapter configs');
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
