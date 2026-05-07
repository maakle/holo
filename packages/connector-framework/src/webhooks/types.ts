export interface WebhookEnvelope {
  rawBody: string;
  headers: Record<string, string>;
}

export interface NormalizedWebhookEvent {
  /** Provider-defined event name (e.g. 'push', 'message.created'). */
  kind: string;
  /** Stable id from the provider (event id, delivery id). Used for dedupe. */
  externalId: string;
  payload: Record<string, unknown>;
}

export interface WebhookVerifier {
  verify(env: WebhookEnvelope, secret: string): boolean;
}

export interface WebhookContext {
  organizationId: string;
  sourceId: string;
}

export interface WebhookSpec {
  verify: WebhookVerifier;
  /** Convert a verified envelope into a normalized event. */
  normalize(env: WebhookEnvelope): NormalizedWebhookEvent;
  /** Side-effect handler — typically enqueues an incremental sync. */
  handle?(ctx: WebhookContext, event: NormalizedWebhookEvent): Promise<void>;
}
