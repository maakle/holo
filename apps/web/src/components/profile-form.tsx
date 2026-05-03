'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { authClient } from '@holo/auth/client';
import { Button } from '@/components/ui/button';

type Status = { kind: 'idle' } | { kind: 'saving' };

export function ProfileForm({
  initialName,
  email,
}: {
  initialName: string;
  email: string;
}) {
  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === initialName) return;
    setStatus({ kind: 'saving' });
    try {
      const result = await authClient.updateUser({ name: trimmed });
      if (result?.error) {
        toast.error(result.error.message ?? 'Failed to update profile');
        setStatus({ kind: 'idle' });
        return;
      }
      toast.success('Profile updated');
      setStatus({ kind: 'idle' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update profile');
      setStatus({ kind: 'idle' });
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-lg border border-border bg-surface p-5">
      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-text-subtle" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          disabled
          className="h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-[13px] text-text-muted"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-text-subtle" htmlFor="name">
          Display name
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="h-9 w-full rounded-md border border-border bg-bg px-3 text-[13px] text-text outline-hidden transition-colors focus:border-border-strong focus-visible:focus-ring"
        />
      </div>

      <Button
        type="submit"
        variant="primary"
        disabled={status.kind === 'saving' || !name.trim() || name.trim() === initialName}
      >
        {status.kind === 'saving' ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  );
}
