import { describe, expect, it } from 'vitest';

import { buildLocalRehearsalSteps } from './rehearse-local.mjs';

describe('local platform rehearsal', () => {
  it('pins every database command to a disposable local state directory', () => {
    const steps = buildLocalRehearsalSteps('/tmp/publishing-local-test');

    expect(steps).toHaveLength(2);
    for (const args of steps) {
      expect(args).toContain('--local');
      expect(args).not.toContain('--remote');
      expect(args).toContain('--persist-to');
      expect(args).toContain('/tmp/publishing-local-test');
    }
  });

  it('applies migrations before inspecting the resulting schema', () => {
    const [migrate, inspect] = buildLocalRehearsalSteps('/tmp/state');

    expect(migrate.slice(0, 4)).toEqual([
      'd1',
      'migrations',
      'apply',
      'publishing-platform-local',
    ]);
    expect(inspect.slice(0, 3)).toEqual([
      'd1',
      'execute',
      'publishing-platform-local',
    ]);
    expect(inspect.join(' ')).toContain('artifact_uploads');
    expect(inspect.join(' ')).toContain('web_entity_manifests');
  });
});
