import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import * as rehearsal from './rehearse-runtime.mjs';

describe('disposable runtime rehearsal safety', () => {
  it('launches only the two fixture producer phases with a validated loopback origin', () => {
    expect(rehearsal.buildProducerCommand).toBeTypeOf('function');
    for (const mode of ['submit-lost', 'recover']) {
      const args = rehearsal.buildProducerCommand(mode, '/tmp/runtime-fixture', 'http://127.0.0.1:8799');
      expect(args[0]).toMatch(/tooling\/rehearse-producer.mjs$/u);
      expect(args.slice(1)).toEqual([mode, '/tmp/runtime-fixture', 'http://127.0.0.1:8799']);
    }
    expect(() => rehearsal.buildProducerCommand('deploy', '/tmp/runtime-fixture', 'http://127.0.0.1:8799')).toThrow();
    expect(() => rehearsal.buildProducerCommand('recover', '/tmp/runtime-fixture', 'https://external.test')).toThrow();
  });
  it('registers no signal handlers merely by importing the tool', async () => {
    const before = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
    await import(`${new URL('./rehearse-runtime.mjs', import.meta.url).href}?import-only`);
    expect(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal))).toEqual(before);
  });
  it('restores scoped signal listeners after normal completion', async () => {
    const before = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
    await rehearsal.withRuntimeProcesses(async () => {});
    expect(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal))).toEqual(before);
  });
  it.each([['SIGINT', false], ['SIGTERM', false], ['SIGINT', true], ['SIGTERM', true]])('removes detached child and descendant on %s (parent exits: %s)', async (signal, parentExits) => {
    const grandchildCode = "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)";
    const childCode = `const {spawn}=require('node:child_process'); process.on('SIGTERM',()=>{${parentExits ? 'process.exit(0)' : ''}}); const grand=spawn(process.execPath,['-e',${JSON.stringify(grandchildCode)}],{stdio:['ignore','pipe','ignore']}); grand.stdout.once('data',()=>console.log(JSON.stringify([process.pid,grand.pid]))); setInterval(()=>{},1000);`;
    const program = `import {spawn} from 'node:child_process'; import {withRuntimeProcesses} from ${JSON.stringify(new URL('./rehearse-runtime.mjs', import.meta.url).href)}; await withRuntimeProcesses(async scope => { const child=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{detached:true,stdio:['ignore','pipe','ignore']}); scope.track(child); child.stdout.pipe(process.stdout); await new Promise(()=>{}); });`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', program], { stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise(resolve => child.once('exit', (code, exitSignal) => resolve({code, signal: exitSignal})));
    let ids = [];
    try {
      ids = await Promise.race([new Promise((resolve, reject) => {
        let text = '';
        child.stdout.on('data', chunk => { text += chunk; if (text.includes('\n')) resolve(JSON.parse(text.trim())); });
        child.once('exit', () => reject(new Error('Fixture exited before ready')));
      }), delay(4000).then(() => { throw new Error('Fixture readiness timeout'); })]);
      child.kill(signal);
      const result = await Promise.race([exited, delay(8000).then(() => { throw new Error('Fixture cleanup timeout'); })]);
      expect(result).toEqual({ code: signal === 'SIGINT' ? 130 : 143, signal: null });
      for (let attempt = 0; attempt < 20 && ids.some(alive); attempt += 1) await delay(50);
      expect(ids.map(alive)).toEqual([false, false]);
    } finally {
      child.kill('SIGKILL');
      for (const id of ids) { try { process.kill(id, 'SIGKILL'); } catch { /* Already removed. */ } }
    }
  }, 15000);
  it('refuses Wrangler legacy home configuration rather than inheriting authentication', () => {
    expect(() => rehearsal.assertNoLegacyConfiguration(true)).toThrow('legacy');
    expect(() => rehearsal.assertNoLegacyConfiguration(false)).not.toThrow();
  });
  it('recognizes only a verified shadow receipt, not an intermediate delivery', () => {
    const delivery = { state: 'verified', provider: 'social.shadow', remoteId: `shadow:${'a'.repeat(64)}` };
    expect(rehearsal.isVerifiedShadowReceipt(delivery)).toBe(true);
    expect(rehearsal.isVerifiedShadowReceipt({ ...delivery, state: 'delivered' })).toBe(false);
    expect(rehearsal.isVerifiedShadowReceipt({ ...delivery, provider: 'social.buffer' })).toBe(false);
  });
  it('builds only fixture bindings and shadow adapter without inherited config', () => {
    const config = rehearsal.buildRuntimeConfig();
    expect(config.vars.ENABLED_ADAPTERS).toBe('social.shadow');
    expect(config.vars.ADAPTER_CONFIGS).toBe('{}');
    expect(config.env).toBeUndefined();
    expect(config.triggers).toBeUndefined();
    expect(config.d1_databases[0].database_id).toBe('00000000-0000-0000-0000-000000000099');
    expect(config.main).toMatch(/apps\/worker\/src\/index.ts$/u);
    expect(config.d1_databases[0].migrations_dir).toMatch(/apps\/worker\/migrations$/u);
  });
  it('pins every command to generated local config and persistence', () => {
    for (const action of ['migrate', 'seed', 'inspect', 'dev']) {
      const args = rehearsal.buildRuntimeCommand(action, '/tmp/runtime-fixture', 8799);
      expect(args).toContain('--local');
      expect(args).toContain('/tmp/runtime-fixture/wrangler.json');
      expect(args).toContain('/tmp/runtime-fixture/state');
      expect(args).not.toContain('--remote');
      expect(args).not.toContain('--env');
    }
  });
  it.each(['deploy', 'remote', 'delete'])('rejects arbitrary action %s', action => {
    expect(() => rehearsal.buildRuntimeCommand(action, '/tmp/runtime-fixture', 8799)).toThrow();
  });
  it('does not inherit credentials or runtime injection', () => {
    const env = rehearsal.buildRuntimeEnvironment({ PATH: '/bin', HOME: '/private-home', CLOUDFLARE_API_TOKEN: 'real', BUFFER_API_KEY: 'real', NODE_OPTIONS: '--import=bad', HTTP_PROXY: 'https://external' }, '/tmp/runtime-fixture');
    expect(env.PATH).toBe('/bin');
    expect(env.HOME).toBeUndefined();
    expect(env.CLOUDFLARE_API_TOKEN).toBeUndefined();
    expect(env.BUFFER_API_KEY).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.HTTP_PROXY).toBeUndefined();
    expect(env.WRANGLER_SEND_METRICS).toBe('false');
    expect(env.WRANGLER_LOG).toBe('log');
  });
  it.each(['https://example.com', 'http://localhost:8799', 'http://127.0.0.1:8799@evil.test', 'http://127.0.0.1:8799/path'])('rejects unsafe base URL %s', url => {
    expect(() => rehearsal.assertLoopbackUrl(url)).toThrow();
  });
  it('allows only explicit loopback HTTP origin', () => {
    expect(rehearsal.assertLoopbackUrl('http://127.0.0.1:8799')).toBe('http://127.0.0.1:8799');
  });
});

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
