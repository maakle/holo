'use client';

import { useEffect } from 'react';
import { posthogClient } from '@/lib/posthog/client';

type Props = {
  userId: string;
  email: string;
  name: string | null;
  orgId: string;
  orgName: string;
  orgSlug: string | null;
};

/**
 * Mounted inside the authenticated app layout once user + active workspace
 * are known on the server. Identifies the user to PostHog and tags every
 * subsequent capture with a group key for the active organization so
 * dashboards can roll up by workspace.
 */
export function PostHogIdentify({
  userId,
  email,
  name,
  orgId,
  orgName,
  orgSlug,
}: Props) {
  useEffect(() => {
    const ph = posthogClient();
    ph.identify(userId, { email, name });
    ph.group('organization', orgId, { name: orgName, slug: orgSlug });
  }, [userId, email, name, orgId, orgName, orgSlug]);
  return null;
}
