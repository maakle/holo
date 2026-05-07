/**
 * HubSpot API response shapes — narrow projections of the v3 CRM endpoints.
 */

export type HubspotObjectType = 'contacts' | 'deals' | 'companies';

export interface HubspotRecord {
  id: string;
  properties: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
}

export interface HubspotEngagement {
  id: string;
  engagementType: 'note' | 'call' | 'email' | 'meeting' | 'task';
  createdAt: string;
  body: string;
  ownerId?: string;
  subject?: string;
  callOutcome?: string;
  callDurationSec?: number;
}

export interface HubspotPage {
  results: HubspotRecord[];
  paging?: { next?: { after: string } };
}
