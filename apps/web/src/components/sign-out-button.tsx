'use client';
import { signOut } from '@holo/auth/client';
import { Button } from '@/components/ui/button';
import { posthogClient } from '@/lib/posthog/client';

export function SignOutButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        await signOut();
        posthogClient().reset();
        window.location.href = '/sign-in';
      }}
    >
      Sign out
    </Button>
  );
}
