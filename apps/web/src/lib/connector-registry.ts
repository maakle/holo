export interface ConnectorMeta {
  id: 'github' | 'slack' | 'notion' | 'grain' | 'pylon' | 'hubspot';
  displayName: string;
  description: string;
  implemented: boolean;
  flowType: 'oauth' | 'apikey'; // oauth = redirect flow, apikey = inline form
}

export const CONNECTORS: ConnectorMeta[] = [
  {
    id: 'github',
    displayName: 'GitHub',
    description: 'Code, pull requests, issues, and markdown docs.',
    implemented: true,
    flowType: 'oauth',
  },
  {
    id: 'slack',
    displayName: 'Slack',
    description: 'Channels, threads, DMs.',
    implemented: true,
    flowType: 'oauth',
  },
  {
    id: 'notion',
    displayName: 'Notion',
    description: 'Pages and databases.',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'grain',
    displayName: 'Grain',
    description: 'Meeting recordings + transcripts.',
    implemented: true,
    flowType: 'oauth',
  },
  {
    id: 'pylon',
    displayName: 'Pylon',
    description: 'Customer support tickets.',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'hubspot',
    displayName: 'HubSpot',
    description: 'CRM contacts, deals, companies, and engagement timelines.',
    implemented: true,
    flowType: 'apikey',
  },
];
