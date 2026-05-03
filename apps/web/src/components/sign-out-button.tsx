'use client';
import { signOut } from '@holo/auth/client';
import { Button } from '@/components/ui/button';

export function SignOutButton() {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        await signOut();
        window.location.href = '/sign-in';
      }}
    >
      Sign out
    </Button>
  );
}
