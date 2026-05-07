export type ConnectorCategoryId =
  | 'source-control'
  | 'communication'
  | 'productivity'
  | 'customer';

export interface ConnectorCategory {
  id: ConnectorCategoryId;
  label: string;
}

export const CONNECTOR_CATEGORIES: ConnectorCategory[] = [
  { id: 'source-control', label: 'Source Control' },
  { id: 'communication', label: 'Communication' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'customer', label: 'Customer & CRM' },
];

export interface ConnectorMeta {
  id: 'github' | 'slack' | 'notion' | 'grain' | 'pylon' | 'hubspot';
  displayName: string;
  description: string;
  category: ConnectorCategoryId;
  implemented: boolean;
  flowType: 'oauth' | 'apikey'; // oauth = redirect flow, apikey = inline form
}

export const CONNECTORS: ConnectorMeta[] = [
  {
    id: 'github',
    displayName: 'GitHub',
    description: 'Code, pull requests, issues, and markdown docs.',
    category: 'source-control',
    implemented: true,
    flowType: 'oauth',
  },
  {
    id: 'slack',
    displayName: 'Slack',
    description: 'Channels, threads, DMs.',
    category: 'communication',
    implemented: true,
    flowType: 'oauth',
  },
  {
    id: 'notion',
    displayName: 'Notion',
    description: 'Pages and databases.',
    category: 'productivity',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'grain',
    displayName: 'Grain',
    description: 'Meeting recordings + transcripts.',
    category: 'productivity',
    implemented: true,
    flowType: 'oauth',
  },
  {
    id: 'pylon',
    displayName: 'Pylon',
    description: 'Customer support tickets.',
    category: 'customer',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'hubspot',
    displayName: 'HubSpot',
    description: 'CRM contacts, deals, companies, and engagement timelines.',
    category: 'customer',
    implemented: true,
    flowType: 'apikey',
  },
];
