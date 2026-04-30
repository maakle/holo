import { describe, it, expect } from 'vitest';
import { HealthController } from '../src/health.controller';

describe('HealthController', () => {
  it('returns ok status', () => {
    const ctrl = new HealthController();
    expect(ctrl.health()).toEqual({ status: 'ok', service: 'api' });
  });
});
