'use client';
import { signOut } from '@holo/auth/client';

export function SignOutButton() {
  return (
    <button
      onClick={async () => {
        await signOut();
        window.location.href = '/sign-in';
      }}
      className="text-xs text-gray-500 underline"
    >
      Sign out
    </button>
  );
}
