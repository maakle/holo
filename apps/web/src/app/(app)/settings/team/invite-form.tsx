'use client';

import { useActionState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { inviteMember } from './actions';

const inputClass =
  'h-9 rounded-md border border-border bg-transparent px-3 text-[13px] outline-hidden placeholder:text-text-subtle focus:border-transparent focus:outline-solid focus:outline-2 focus:outline-accent disabled:opacity-50';

interface State {
  ok: boolean;
  error?: string;
}

const INITIAL: State = { ok: false };

async function action(_prev: State, formData: FormData): Promise<State> {
  const result = await inviteMember(formData);
  if (result.ok) {
    toast.success(`Invitation sent to ${String(formData.get('email'))}`);
  } else if (result.error) {
    toast.error(result.error);
  }
  return result;
}

export function InviteForm() {
  const [, formAction, pending] = useActionState(action, INITIAL);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 sm:flex-row sm:items-end"
    >
      <label className="flex flex-1 flex-col gap-1.5">
        <span className="caption text-text-subtle">Email</span>
        <input
          name="email"
          type="email"
          required
          placeholder="teammate@company.com"
          disabled={pending}
          className={`${inputClass} w-full`}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="caption text-text-subtle">Role</span>
        <div className="relative">
          <select
            name="role"
            defaultValue="member"
            disabled={pending}
            className={`${inputClass} w-full appearance-none pr-8`}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted"
            aria-hidden
          />
        </div>
      </label>
      <Button type="submit" variant="primary" disabled={pending} className="sm:self-end">
        <Mail className="h-3.5 w-3.5" />
        {pending ? 'Sending…' : 'Send invite'}
      </Button>
    </form>
  );
}
