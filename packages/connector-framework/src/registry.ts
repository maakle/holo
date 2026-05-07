import { ErrorCode, holoError } from '@holo/errors';
import type { ConnectorSpec } from './types';

/**
 * Lazy registry of connector specs. The web app and the worker both call
 * `registerSpecs(...)` at boot with the same array; lookup is by id.
 *
 * Kept as a module-scoped Map rather than passed everywhere — the spec list
 * is process-wide infrastructure (like routes), not per-request state.
 */
const REGISTRY = new Map<string, ConnectorSpec>();

export function registerSpecs(specs: ReadonlyArray<ConnectorSpec>): void {
  for (const spec of specs) {
    if (REGISTRY.has(spec.id) && REGISTRY.get(spec.id) !== spec) {
      throw holoError({
        code: ErrorCode.HOLO_INTERNAL,
        problem: `Connector spec id '${spec.id}' registered twice with different objects`,
        fix: 'Ensure registerSpecs() is called once with the canonical spec list.',
      });
    }
    REGISTRY.set(spec.id, spec);
  }
}

export function getSpec(id: string): ConnectorSpec {
  const spec = REGISTRY.get(id);
  if (!spec) {
    throw holoError({
      code: ErrorCode.HOLO_NOT_FOUND,
      problem: `No connector spec registered for id '${id}'`,
      fix: 'Verify the provider id and that registerSpecs() ran at boot.',
    });
  }
  return spec;
}

export function listSpecs(): ReadonlyArray<ConnectorSpec> {
  return [...REGISTRY.values()];
}

/** Test seam — clears the registry between cases. */
export function __resetRegistryForTests(): void {
  REGISTRY.clear();
}
