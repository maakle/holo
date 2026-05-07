import { ErrorCode, holoError } from '@holo/errors';
import type { ConnectorSpec, ResourceSpec } from './types';

/**
 * Identity helper. The only thing it adds today is type inference for the
 * spec literal — keeping it as a function leaves room to add validation
 * later (duplicate resource ids, reserved scope names, etc.) without
 * touching call sites.
 */
export function defineConnector(spec: ConnectorSpec): ConnectorSpec {
  const ids = new Set<string>();
  for (const r of spec.resources) {
    if (ids.has(r.id)) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `defineConnector(${spec.id}): duplicate resource id ${JSON.stringify(r.id)}`,
        fix: 'Resource ids must be unique within a single connector spec.',
      });
    }
    ids.add(r.id);
  }
  return spec;
}

/**
 * Type-preserving helper for a single resource. Lets call sites keep their
 * cursor type narrow without having to spell it out twice — the inferred
 * TCursor is captured in the returned ResourceSpec.
 */
export function defineResource<TCursor>(spec: ResourceSpec<TCursor>): ResourceSpec<TCursor> {
  return spec;
}
