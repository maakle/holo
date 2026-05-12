import Image from 'next/image';
import { CONNECTORS, type ConnectorMeta } from '@/lib/connector-registry';

interface Props {
  id: ConnectorMeta['id'];
  className?: string;
}

/**
 * Brand assets per connector. Connectors without an asset (typically new
 * additions awaiting a real webp drop-in) fall through to a text-initial
 * rendering so the page still works without breaking the typecheck or the
 * Image runtime.
 */
const FILE_BY_ID: Partial<Record<ConnectorMeta['id'], string>> = {
  github: '/connectors/github.webp',
  gitlab: '/connectors/gitlab.webp',
  slack: '/connectors/slack.webp',
  notion: '/connectors/notion.webp',
  grain: '/connectors/grain.webp',
  pylon: '/connectors/usepylon.webp',
  hubspot: '/connectors/hubspot.webp',
  linear: '/connectors/linear.webp',
  mintlify: '/connectors/mintlify.png',
  zendesk: '/connectors/zendesk.png',
  googledrive: '/connectors/googledrive.webp',
  airtable: '/connectors/airtable.webp',
  'google-chat': '/connectors/googlechat.webp',
  asana: '/connectors/asana.webp',
  confluence: '/connectors/confluence.webp',
  jira: '/connectors/jira.webp',
  intercom: '/connectors/intercom.webp',
  'microsoft-teams': '/connectors/teams.webp',
  'microsoft-365': '/connectors/office.webp',
  salesforce: '/connectors/salesforce.webp',
  stripe: '/connectors/stripe.webp',
};

export function ConnectorLogo({ id, className }: Props) {
  const src = FILE_BY_ID[id];
  if (src) {
    return (
      <Image
        src={src}
        alt=""
        width={40}
        height={40}
        className={className ?? 'h-5 w-5 object-contain'}
        aria-hidden="true"
      />
    );
  }
  const meta = CONNECTORS.find((c) => c.id === id);
  const initial = (meta?.displayName ?? id).charAt(0).toUpperCase();
  return (
    <span
      className={
        className ??
        'flex h-5 w-5 items-center justify-center rounded-sm bg-surface-2 text-[10px] font-medium text-text-muted'
      }
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
