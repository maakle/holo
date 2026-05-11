export type ConnectorCategoryId = 'source-control' | 'communication' | 'productivity' | 'customer';

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
  id:
    | 'github'
    | 'gitlab'
    | 'slack'
    | 'notion'
    | 'grain'
    | 'pylon'
    | 'hubspot'
    | 'linear'
    | 'mintlify'
    | 'zendesk'
    | 'googledrive'
    | 'airtable'
    | 'google-chat'
    | 'confluence'
    | 'jira'
    | 'intercom'
    | 'microsoft-teams'
    | 'microsoft-365'
    | 'asana';
  displayName: string;
  description: string;
  category: ConnectorCategoryId;
  /**
   * `true` when the connector has a working ingestion path + wizard. `false`
   * means the tile renders in the UI as "Coming soon" — no connect flow, no
   * wizard config required. Treat `implemented: false` as the public roadmap
   * surface: anything from `docs/ROADMAP.md` "Next connections to build" that
   * we want users to see is queued.
   */
  implemented: boolean;
  flowType: 'oauth' | 'apikey' | 'service-account'; // oauth = redirect flow, apikey = inline form, service-account = paste JSON key + impersonation email
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
    id: 'gitlab',
    displayName: 'GitLab',
    description: 'Code, merge requests, issues, and markdown docs.',
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
    flowType: 'apikey',
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
  {
    id: 'linear',
    displayName: 'Linear',
    description: 'Issues with title, description, status, priority, team, and labels.',
    category: 'productivity',
    implemented: true,
    flowType: 'oauth',
  },
  {
    id: 'mintlify',
    displayName: 'Mintlify Docs',
    description: 'Public Mintlify-hosted documentation: pages and OpenAPI reference.',
    category: 'productivity',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'zendesk',
    displayName: 'Zendesk Help Center',
    description: 'Public Zendesk help center articles, with section + category breadcrumb.',
    category: 'customer',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'googledrive',
    displayName: 'Google Drive',
    description:
      'Google Docs, Sheets, Slides, and uploaded text/markdown files across My Drive and Shared Drives.',
    category: 'productivity',
    implemented: true,
    flowType: 'service-account',
  },
  {
    id: 'airtable',
    displayName: 'Airtable',
    description: 'Bases, tables, and records the personal access token can see.',
    category: 'productivity',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'asana',
    displayName: 'Asana',
    description: 'Tasks with name, notes, status, assignee, projects, and tags.',
    category: 'productivity',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'google-chat',
    displayName: 'Google Chat',
    description: 'Spaces, threads, and messages from Google Chat.',
    category: 'communication',
    implemented: true,
    flowType: 'service-account',
  },
  // Coming soon — surfaced from docs/ROADMAP.md "Next connections to build".
  // Order here matches the visible category sort (alphabetical by display
  // name); the roadmap doc remains the source of truth for build priority.
  {
    id: 'confluence',
    displayName: 'Confluence',
    description: 'Spaces, pages, and inline comments from Confluence Cloud.',
    category: 'productivity',
    implemented: false,
    flowType: 'oauth',
  },
  {
    id: 'jira',
    displayName: 'Jira',
    description: 'Issues with inline comments and project metadata from Jira Cloud.',
    category: 'productivity',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'intercom',
    displayName: 'Intercom',
    description: 'Conversations, contacts, and help center articles.',
    category: 'customer',
    implemented: false,
    flowType: 'oauth',
  },
  {
    id: 'microsoft-teams',
    displayName: 'Microsoft Teams',
    description: 'Channels, threads, and messages from Microsoft Teams.',
    category: 'communication',
    implemented: false,
    flowType: 'oauth',
  },
  {
    id: 'microsoft-365',
    displayName: 'Microsoft 365',
    description: 'SharePoint sites, OneDrive files, and Office documents.',
    category: 'productivity',
    implemented: false,
    flowType: 'oauth',
  },
];
