export interface ConnectorMeta {
  id: 'github' | 'slack' | 'notion' | 'grain' | 'pylon' | 'hubspot';
  displayName: string;
  description: string;
  implemented: boolean;
}

export const CONNECTORS: ConnectorMeta[] = [
  {
    id: 'github',
    displayName: 'GitHub',
    description: 'Pull requests, issues, repo metadata.',
    implemented: true,
  },
  { id: 'slack', displayName: 'Slack', description: 'Channels, threads, DMs.', implemented: false },
  {
    id: 'notion',
    displayName: 'Notion',
    description: 'Pages, databases, comments.',
    implemented: false,
  },
  {
    id: 'grain',
    displayName: 'Grain',
    description: 'Meeting recordings + transcripts.',
    implemented: false,
  },
  {
    id: 'pylon',
    displayName: 'Pylon',
    description: 'Customer support tickets.',
    implemented: false,
  },
  {
    id: 'hubspot',
    displayName: 'HubSpot',
    description: 'CRM contacts, deals, companies.',
    implemented: false,
  },
];
