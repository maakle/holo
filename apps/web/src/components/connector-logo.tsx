import type { ConnectorMeta } from '@/lib/connector-registry';

interface Props {
  id: ConnectorMeta['id'];
  className?: string;
}

// Inline brand marks. Sized 1em; color via currentColor unless brand color is
// essential to recognition (Slack, Notion, HubSpot, Grain). Kept monochrome
// where the wordmark is the recognizable thing (GitHub, Pylon).
export function ConnectorLogo({ id, className }: Props) {
  const cls = className ?? 'h-5 w-5';
  switch (id) {
    case 'github':
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.27-.01-1-.02-1.96-3.2.69-3.87-1.54-3.87-1.54-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.26 5.68.41.36.77 1.07.77 2.16 0 1.56-.01 2.82-.01 3.2 0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z"
          />
        </svg>
      );
    case 'slack':
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden="true">
          <path fill="#36C5F0" d="M5.04 15.16a2.52 2.52 0 1 1-2.52-2.52h2.52v2.52Zm1.27 0a2.52 2.52 0 0 1 5.04 0v6.31a2.52 2.52 0 0 1-5.04 0v-6.31Z" />
          <path fill="#2EB67D" d="M8.83 5.04a2.52 2.52 0 1 1 2.52-2.52v2.52H8.83Zm0 1.27a2.52 2.52 0 0 1 0 5.04H2.52a2.52 2.52 0 1 1 0-5.04h6.31Z" />
          <path fill="#ECB22E" d="M18.96 8.84a2.52 2.52 0 1 1 2.52 2.52h-2.52V8.84Zm-1.27 0a2.52 2.52 0 0 1-5.04 0V2.52a2.52 2.52 0 0 1 5.04 0v6.31Z" />
          <path fill="#E01E5A" d="M15.16 18.96a2.52 2.52 0 1 1-2.52 2.52v-2.52h2.52Zm0-1.27a2.52 2.52 0 0 1 0-5.04h6.31a2.52 2.52 0 1 1 0 5.04h-6.31Z" />
        </svg>
      );
    case 'notion':
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden="true">
          <path
            fill="currentColor"
            d="M4.46 3.16 14.9 2.4c1.28-.11 1.61-.04 2.42.55l3.33 2.34c.55.4.73.51.73.95v12.86c0 .8-.29 1.28-1.32 1.35l-12.13.73c-.77.04-1.13-.07-1.54-.59l-2.45-3.18c-.44-.6-.62-1.05-.62-1.57V4.62c0-.66.29-1.21 1.14-1.46Zm10.65 1.13c-.74.05-.91.7-.46 1.06l1.51 1.06c.34.26.59.22 1.13.18l3.94-.24c.34 0 .07-.34-.04-.4l-1.84-1.32c-.36-.26-.84-.55-1.66-.48l-2.58.14ZM4.62 6.79v12.06c0 .55.27.74.91.7l13.16-.77c.64-.04.71-.44.71-.91V5.92c0-.46-.18-.7-.58-.66l-13.7.81c-.43.05-.5.26-.5.72Zm12.34.59c.07.34 0 .69-.33.73l-.62.13v9.06c-.55.29-1.06.45-1.47.45-.66 0-.83-.21-1.32-.83l-4.05-6.36v6.16l1.28.29s0 .73-1.02.73l-2.81.17c-.07-.18 0-.59.29-.66l.74-.21V8.37l-1.04-.08c-.07-.34.11-.84.62-.88l3.02-.18 4.16 6.36V8.07l-1.06-.13c-.07-.41.21-.7.55-.73l2.99-.17Z"
          />
        </svg>
      );
    case 'grain':
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#FF642D" />
          <circle cx="12" cy="12" r="3.6" fill="#FFFFFF" />
        </svg>
      );
    case 'pylon':
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 4h6.5a4.75 4.75 0 0 1 0 9.5H7.5V20H4V4Zm3.5 6.5h2.9a1.75 1.75 0 0 0 0-3.5H7.5v3.5ZM15.25 13.5l3 6.5h-3.5l-2.7-6h3.2Z"
          />
        </svg>
      );
    case 'hubspot':
      return (
        <svg viewBox="0 0 24 24" className={cls} aria-hidden="true">
          <path
            fill="#FF7A59"
            d="M18.16 8.86V6.43a1.86 1.86 0 1 0-1.5 0v2.43a5.27 5.27 0 0 0-2.5 1.1L7.5 5.07a2.1 2.1 0 1 0-1.27 1.6l6.5 4.78a5.3 5.3 0 0 0-.81 2.83 5.3 5.3 0 0 0 .9 2.96l-1.95 1.95a1.7 1.7 0 1 0 1.2 1.2l1.94-1.95a5.32 5.32 0 1 0 4.15-9.59Zm-.75 8.06a2.74 2.74 0 1 1 0-5.48 2.74 2.74 0 0 1 0 5.48Z"
          />
        </svg>
      );
  }
}
