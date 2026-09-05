export type ParsedCommand =
  | { method: 'GET'; path: string }
  | { method: 'POST'; path: string; body: { reason: string } };

export function parseCommand(arguments_: string[]): ParsedCommand {
  const [command, target] = arguments_;
  if (command === 'status' || command === 'capacity') {
    return { method: 'GET', path: '/admin/health/ready' };
  }
  if (command === 'inspect') {
    return {
      method: 'GET',
      path: `/admin/publications/${segment(required(target, 'publication id'))}?tenant=${query(requiredOption(arguments_, '--tenant'))}`,
    };
  }
  if (command === 'deliveries') {
    const tenant = requiredOption(arguments_, '--tenant');
    const state = option(arguments_, '--state');
    return {
      method: 'GET',
      path: `/admin/deliveries?tenant=${query(tenant)}${state === undefined ? '' : `&state=${query(state)}`}`,
    };
  }
  if (command === 'replay') {
    const tenant = requiredOption(arguments_, '--tenant');
    return {
      method: 'POST',
      path: `/admin/deliveries/${segment(required(target, 'delivery id'))}/replay?tenant=${query(tenant)}`,
      body: { reason: requiredOption(arguments_, '--reason') },
    };
  }
  if (command === 'pause' || command === 'resume') {
    const [tenant, adapter] = required(target, 'tenant/adapter').split('/', 2);
    if (!tenant || !adapter) throw new Error('A tenant/adapter target is required');
    return {
      method: 'POST',
      path: `/admin/adapters/${segment(tenant)}/${segment(adapter)}/${command}`,
      body: { reason: requiredOption(arguments_, '--reason') },
    };
  }
  throw new Error('Unknown publishing command');
}

function option(arguments_: readonly string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);
  const value = index < 0 ? undefined : arguments_[index + 1];
  return value?.startsWith('--') === true ? undefined : value;
}

function requiredOption(arguments_: readonly string[], name: string): string {
  return required(option(arguments_, name), name.slice(2));
}

function required(value: string | undefined, label: string): string {
  if (value === undefined || value.trim().length === 0) throw new Error(`A ${label} is required`);
  return value.trim();
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function query(value: string): string {
  return encodeURIComponent(value);
}
