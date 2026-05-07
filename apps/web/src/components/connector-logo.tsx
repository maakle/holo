import Image from 'next/image';
import type { ConnectorMeta } from '@/lib/connector-registry';

interface Props {
  id: ConnectorMeta['id'];
  className?: string;
}

const FILE_BY_ID: Record<ConnectorMeta['id'], string> = {
  github: '/connectors/github.webp',
  slack: '/connectors/slack.webp',
  notion: '/connectors/notion.webp',
  grain: '/connectors/grain.webp',
  pylon: '/connectors/usepylon.webp',
  hubspot: '/connectors/hubspot.webp',
  linear: '/connectors/linear.webp',
};

export function ConnectorLogo({ id, className }: Props) {
  const src = FILE_BY_ID[id];
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
