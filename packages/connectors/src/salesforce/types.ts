/**
 * Salesforce REST API response shapes — narrow projections of the v60.0 SObject
 * and Query endpoints. Salesforce returns one row per SObject; field values are
 * typed in the API but we preserve them as `unknown` here and stringify in the
 * sync layer (matching how HubSpot's stringy properties flow through).
 */

export type SalesforceObjectType = 'Account' | 'Contact' | 'Opportunity';

/**
 * Resource id as seen on `connector_cursors.scope`. Matches HubSpot's lowercase
 * plural convention so the dashboard groups them cleanly.
 */
export type SalesforceResourceId = 'accounts' | 'contacts' | 'opportunities';

export const RESOURCE_TO_OBJECT: Record<SalesforceResourceId, SalesforceObjectType> = {
  accounts: 'Account',
  contacts: 'Contact',
  opportunities: 'Opportunity',
};

export interface SalesforceRecord {
  Id: string;
  /** SOQL surfaces SystemModstamp as ISO 8601 with timezone offset. */
  SystemModstamp: string;
  CreatedDate: string;
  [field: string]: unknown;
}

export interface SalesforceQueryResponse<T = SalesforceRecord> {
  totalSize: number;
  done: boolean;
  /** When `done = false`, follow this URL via REST to fetch the next page. */
  nextRecordsUrl?: string;
  records: T[];
}

export interface SalesforceActivityRecord {
  Id: string;
  WhatId?: string | null;
  WhoId?: string | null;
  Subject?: string | null;
  Description?: string | null;
  ActivityDate?: string | null;
  CreatedDate: string;
  /** Task-only. */
  Status?: string | null;
  /** Task-only. */
  CallType?: string | null;
  /** Task-only — call duration in seconds (Salesforce stores this as integer). */
  CallDurationInSeconds?: number | null;
  /** Event-only. */
  StartDateTime?: string | null;
  /** Event-only. */
  Location?: string | null;
  /** Salesforce User name resolved via Owner.Name in SOQL. */
  Owner?: { Name?: string | null } | null;
  /**
   * Discriminates Task vs. Event in our merged stream — populated by the api
   * layer, not Salesforce itself.
   */
  __kind?: 'task' | 'event';
}

export interface SalesforceContentNoteRecord {
  Id: string;
  Title?: string | null;
  TextPreview?: string | null;
  CreatedDate: string;
  Owner?: { Name?: string | null } | null;
}

/** ContentDocumentLink projection — joins ContentNote → parent record. */
export interface SalesforceContentDocumentLinkRecord {
  ContentDocumentId: string;
  LinkedEntityId: string;
}

export interface SalesforceTokenInfo {
  /** Salesforce identity URL (e.g. https://login.salesforce.com/id/00D.../005...). */
  id: string;
  /** Per-org API host (e.g. https://acme.my.salesforce.com). */
  instanceUrl: string;
}
