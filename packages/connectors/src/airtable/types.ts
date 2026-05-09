/**
 * Response types for the slice of the Airtable Web API we use. Narrow on
 * purpose — only the fields we actually project into chunks/metadata are
 * typed.
 *
 * Airtable docs: https://airtable.com/developers/web/api/introduction
 */

export interface AirtableUserMe {
  id: string;
  email?: string;
  scopes?: string[];
}

export interface AirtableBase {
  id: string;
  name: string;
  permissionLevel?: string;
}

export interface AirtableBasesList {
  bases: AirtableBase[];
  offset?: string;
}

export interface AirtableField {
  id: string;
  name: string;
  type: string;
  description?: string;
  options?: Record<string, unknown>;
}

export interface AirtableTable {
  id: string;
  name: string;
  primaryFieldId: string;
  description?: string;
  fields: AirtableField[];
}

export interface AirtableTablesList {
  tables: AirtableTable[];
}

/**
 * Record fields are arbitrary user data. The Airtable API returns one
 * key per field name with a value whose runtime type depends on the field
 * type (string, number, boolean, array, attachment object, …). We project
 * to text in `chunking.ts` and don't try to type every variant here.
 */
export interface AirtableRecord {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

export interface AirtableRecordsList {
  records: AirtableRecord[];
  offset?: string;
}
