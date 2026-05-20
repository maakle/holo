'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { authClient } from '@holo/auth/client';
import { Button } from '@/components/ui/button';
import { trackEvent } from '@/lib/posthog/events';

const inputClass =
  'h-10 w-full rounded-md border border-border bg-transparent px-3 text-[14px] text-text outline-hidden placeholder:text-text-subtle focus:border-transparent focus:outline-solid focus:outline-2 focus:outline-accent disabled:opacity-50';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function CreateWorkspaceForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    const finalSlug = (slugTouched ? slug : slugify(trimmedName)).trim();
    if (!trimmedName || !finalSlug) {
      setError('Name and slug are required.');
      return;
    }
    startTransition(async () => {
      const created = await authClient.organization.create({
        name: trimmedName,
        slug: finalSlug,
      });
      if (created?.error) {
        setError(created.error.message ?? 'Could not create workspace.');
        return;
      }
      const newId = (created?.data as { id?: string } | undefined)?.id;
      if (newId) {
        await authClient.organization.setActive({ organizationId: newId });
        trackEvent('workspace_created', { orgId: newId });
      }
      // Seed Star Wars sample data so the new workspace shows live data
      // immediately. Best-effort — failure here shouldn't block onboarding.
      try {
        await fetch('/api/sample-data', { method: 'POST' });
      } catch {
        // ignore — workspace creation already succeeded
      }
      toast.success(`Workspace "${trimmedName}" created.`);
      router.push('/dashboard');
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-lg border border-border bg-surface p-6">
      <label className="block space-y-1.5">
        <span className="caption text-text-subtle">Name</span>
        <input
          autoFocus
          type="text"
          required
          maxLength={64}
          placeholder="Acme Inc."
          value={name}
          disabled={pending}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
          className={inputClass}
        />
      </label>

      <label className="block space-y-1.5">
        <span className="caption text-text-subtle">Slug</span>
        <input
          type="text"
          required
          maxLength={48}
          placeholder="acme"
          value={slug}
          disabled={pending}
          onChange={(e) => {
            setSlug(slugify(e.target.value));
            setSlugTouched(true);
          }}
          className={`${inputClass} font-mono text-[13px]`}
        />
        <span className="text-[12px] text-text-subtle">
          Used in URLs. Lowercase letters, numbers, and hyphens only.
        </span>
      </label>

      {error ? <p className="text-[13px] text-error">{error}</p> : null}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => router.back()}
        >
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending || !name.trim()}>
          {pending ? 'Creating…' : 'Create workspace'}
        </Button>
      </div>
    </form>
  );
}
