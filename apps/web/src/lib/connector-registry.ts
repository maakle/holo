export type ConnectorCategoryId =
  | 'source-control'
  | 'communication'
  | 'knowledge'
  | 'website'
  | 'project-management'
  | 'meetings'
  | 'crm'
  | 'customer-support'
  | 'payments';

export interface ConnectorCategory {
  id: ConnectorCategoryId;
  label: string;
}

export const CONNECTOR_CATEGORIES: ConnectorCategory[] = [
  { id: 'source-control', label: 'Source Control' },
  { id: 'communication', label: 'Communication' },
  { id: 'knowledge', label: 'Knowledge & Docs' },
  { id: 'website', label: 'Website & CMS' },
  { id: 'project-management', label: 'Project Management' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'crm', label: 'CRM' },
  { id: 'customer-support', label: 'Customer Support' },
  { id: 'payments', label: 'Payments' },
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
    | 'prismic'
    | 'webcrawl'
    | 'zendesk'
    | 'googledrive'
    | 'airtable'
    | 'google-chat'
    | 'confluence'
    | 'jira'
    | 'intercom'
    | 'teams'
    | 'microsoft-365'
    | 'asana'
    | 'stripe'
    | 'salesforce'
    | 'manual-upload';
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
  // oauth = redirect flow, apikey = inline form, service-account = paste JSON
  // key + impersonation email, upload = folder picker (manual file upload).
  flowType: 'oauth' | 'apikey' | 'service-account' | 'upload';
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
    category: 'knowledge',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'grain',
    displayName: 'Grain',
    description: 'Meeting recordings + transcripts.',
    category: 'meetings',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'pylon',
    displayName: 'Pylon',
    description: 'Customer support tickets.',
    category: 'customer-support',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'hubspot',
    displayName: 'HubSpot',
    description: 'CRM contacts, deals, companies, and engagement timelines.',
    category: 'crm',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'salesforce',
    displayName: 'Salesforce',
    description: 'CRM accounts, contacts, opportunities, and activity timelines.',
    category: 'crm',
    implemented: true,
    flowType: 'oauth',
  },
  {
    id: 'linear',
    displayName: 'Linear',
    description: 'Issues with title, description, status, priority, team, and labels.',
    category: 'project-management',
    implemented: true,
    flowType: 'oauth',
  },
  {
    id: 'mintlify',
    displayName: 'Mintlify Docs',
    description: 'Public Mintlify-hosted documentation: pages and OpenAPI reference.',
    category: 'knowledge',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'prismic',
    displayName: 'Prismic',
    description:
      'Prismic CMS documents (FAQs, pages, blog posts); public repos work without a token.',
    category: 'website',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'webcrawl',
    displayName: 'Website',
    description:
      'Scrape a list of pages or crawl an entire website (Firecrawl-powered).',
    category: 'website',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'zendesk',
    displayName: 'Zendesk Help Center',
    description: 'Public Zendesk help center articles, with section + category breadcrumb.',
    category: 'customer-support',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'googledrive',
    displayName: 'Google Drive',
    description:
      'Google Docs, Sheets, Slides, and uploaded text/markdown files across My Drive and Shared Drives.',
    category: 'knowledge',
    implemented: true,
    flowType: 'service-account',
  },
  {
    id: 'airtable',
    displayName: 'Airtable',
    description: 'Bases, tables, and records the personal access token can see.',
    category: 'knowledge',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'asana',
    displayName: 'Asana',
    description: 'Tasks with name, notes, status, assignee, projects, and tags.',
    category: 'project-management',
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
  {
    id: 'stripe',
    displayName: 'Stripe',
    description:
      'Customers, subscriptions, invoices, and charges — for revenue, MRR, and growth metrics.',
    category: 'payments',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'manual-upload',
    displayName: 'Manual Upload',
    description:
      'Drop a folder of .md files exported from any tool — Holo chunks, embeds, and tags them as if they came from the source connector.',
    category: 'knowledge',
    implemented: true,
    flowType: 'upload',
  },
  // Coming soon — surfaced from docs/ROADMAP.md "Next connections to build".
  // Order here matches the visible category sort (alphabetical by display
  // name); the roadmap doc remains the source of truth for build priority.
  {
    id: 'confluence',
    displayName: 'Confluence',
    description: 'Spaces, pages, and inline comments from Confluence Cloud.',
    category: 'knowledge',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'jira',
    displayName: 'Jira',
    description: 'Issues with inline comments and project metadata from Jira Cloud.',
    category: 'project-management',
    implemented: true,
    flowType: 'apikey',
  },
  {
    id: 'intercom',
    displayName: 'Intercom',
    description: 'Conversations, contacts, and help center articles.',
    category: 'customer-support',
    implemented: false,
    flowType: 'oauth',
  },
  {
    id: 'teams',
    displayName: 'Microsoft Teams',
    description:
      'Channel + chat history from resources where the @holo bot is installed (read-only).',
    category: 'communication',
    implemented: true,
    // App-only Graph auth — env-supplied bot creds, no per-org credential
    // form. Closest existing flow type is `apikey` (inline single-step
    // form). The Teams wizard step renders status + an Enable button
    // rather than a token input.
    flowType: 'apikey',
  },
  {
    id: 'microsoft-365',
    displayName: 'Microsoft 365',
    description: 'SharePoint sites, OneDrive files, and Office documents.',
    category: 'knowledge',
    implemented: false,
    flowType: 'oauth',
  },
];
