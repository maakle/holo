import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import type { DB } from '@holo/db';
import { StorageCapReached } from '../src/templates/storage-cap-reached';

// Mock the Resend transport — every test asserts behaviour against this spy
// instead of hitting api.resend.com.
vi.mock('../src/transport', () => ({
  sendViaResend: vi.fn(async () => undefined),
}));

const { sendViaResend } = await import('../src/transport');
const { sendEmail, sendIdempotent } = await import('../src/send');

function makeIdempotentDb(opts: { duplicate?: boolean } = {}) {
  // Stub DB whose insert chain returns either a row (first delivery) or
  // empty (duplicate — onConflictDoNothing collapsed it).
  const lastRowId = '11111111-1111-1111-1111-111111111111';
  const deletes: string[] = [];
  const db = {
    insert: vi.fn(() => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => (opts.duplicate ? [] : [{ id: lastRowId }]),
        }),
      }),
    })),
    delete: vi.fn(() => ({
      where: async (_w: unknown) => {
        deletes.push(lastRowId);
      },
    })),
  } as unknown as DB;
  return { db, deletes };
}

const exampleProps = {
  organizationName: 'Acme Corp',
  currentPlanName: 'Free',
  currentCount: 11_500,
  limit: 10_000,
  suggestedUpgradePlanName: 'Starter',
  upgradeUrl: 'https://holo.dev/settings/billing?upgrade=starter#plans',
};

describe('sendEmail (low-level)', () => {
  beforeEach(() => {
    (sendViaResend as ReturnType<typeof vi.fn>).mockClear();
  });

  it('renders react-email JSX to both html and text, then calls the transport', async () => {
    await sendEmail({
      to: 'admin@acme.com',
      subject: 'Your search index is full',
      kind: 'storage_cap_reached',
      react: createElement(StorageCapReached, exampleProps),
    });

    expect(sendViaResend).toHaveBeenCalledTimes(1);
    const args = (sendViaResend as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(args.to).toBe('admin@acme.com');
    expect(args.subject).toBe('Your search index is full');
    expect(args.tag).toBe('storage_cap_reached');
    // HTML must include the org name and the CTA URL.
    expect(args.html).toContain('Acme Corp');
    expect(args.html).toContain('settings/billing?upgrade=starter');
    // Plain text must include the same details (no HTML tags).
    expect(args.text).toContain('Acme Corp');
    expect(args.text).toContain('11,500');
    expect(args.text).not.toContain('<html');
  });
});

describe('sendIdempotent', () => {
  beforeEach(() => {
    (sendViaResend as ReturnType<typeof vi.fn>).mockClear();
  });

  it('sends + returns true on first delivery', async () => {
    const { db } = makeIdempotentDb({ duplicate: false });
    const sent = await sendIdempotent(db, {
      to: 'admin@acme.com',
      subject: 'Your search index is full',
      kind: 'storage_cap_reached',
      idempotencyKey: 'storage_cap_reached:org-1:2026-05-01',
      organizationId: 'org-1',
      react: createElement(StorageCapReached, exampleProps),
    });
    expect(sent).toBe(true);
    expect(sendViaResend).toHaveBeenCalledTimes(1);
  });

  it('no-ops + returns false on duplicate idempotency key', async () => {
    const { db } = makeIdempotentDb({ duplicate: true });
    const sent = await sendIdempotent(db, {
      to: 'admin@acme.com',
      subject: 'Your search index is full',
      kind: 'storage_cap_reached',
      idempotencyKey: 'storage_cap_reached:org-1:2026-05-01',
      organizationId: 'org-1',
      react: createElement(StorageCapReached, exampleProps),
    });
    expect(sent).toBe(false);
    expect(sendViaResend).not.toHaveBeenCalled();
  });

  it('rolls back the log row if Resend rejects', async () => {
    (sendViaResend as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Resend 500'),
    );
    const { db, deletes } = makeIdempotentDb({ duplicate: false });
    await expect(
      sendIdempotent(db, {
        to: 'admin@acme.com',
        subject: 'Your search index is full',
        kind: 'storage_cap_reached',
        idempotencyKey: 'storage_cap_reached:org-1:2026-05-01',
        organizationId: 'org-1',
        react: createElement(StorageCapReached, exampleProps),
      }),
    ).rejects.toThrow(/Resend 500/);
    expect(deletes).toHaveLength(1);
  });
});
