import { createElement } from 'react';
import type { DB } from '@holo/db';
import { sendIdempotent } from '../send';
import {
  StorageCapReached,
  type StorageCapReachedProps,
} from './storage-cap-reached';

/**
 * Wrapper: hides the JSX template construction from the worker so the
 * worker's tsconfig doesn't need `jsx: react-jsx` set. The worker just
 * calls `sendStorageCapReachedEmail({ to, organizationId, ... })`.
 */
export async function sendStorageCapReachedEmail(
  db: DB,
  args: {
    to: string;
    subject: string;
    organizationId: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
    template: StorageCapReachedProps;
  },
): Promise<boolean> {
  return sendIdempotent(db, {
    to: args.to,
    subject: args.subject,
    kind: 'storage_cap_reached',
    organizationId: args.organizationId,
    idempotencyKey: args.idempotencyKey,
    metadata: args.metadata,
    react: createElement(StorageCapReached, args.template),
  });
}

export { StorageCapReached };
export type { StorageCapReachedProps };
