import { SLACK_BOT_SCOPES, SLACK_INGEST_SCOPES } from './spec';

export interface SlackManifestOptions {
  /** Name shown in Slack's app directory and as the bot user. */
  displayName: string;
  /** OAuth redirect URL — must match `${WEB_PUBLIC_URL}/api/connectors/slack/callback`. */
  oauthRedirectUrl: string;
  /** Events API webhook URL — gateway's `/slack/events/:orgId`. */
  eventsRequestUrl: string;
  /** Slash-command webhook URL — gateway's `/slack/commands/:orgId`. */
  slashCommandsUrl: string;
  /**
   * Interactivity webhook URL — gateway's `/slack/interactivity/:orgId`.
   * Required for the "Show sources" button on agent answers; without it,
   * Slack shows "this app is not configured to handle interactive responses"
   * on click. Optional for back-compat: omitting it keeps interactivity off,
   * matching pre-button behavior.
   */
  interactivityUrl?: string;
  /** Slash command name including the leading slash. Defaults to `/holo`. */
  slashCommand?: string;
}

/**
 * Build a Slack app manifest (YAML) that admins paste into Slack's
 * "Create app from manifest" flow. Scopes come straight from
 * SLACK_INGEST_SCOPES + SLACK_BOT_SCOPES so the manifest can't drift from
 * what the OAuth flow actually requests.
 */
export function buildSlackManifest(opts: SlackManifestOptions): string {
  const slashCommand = opts.slashCommand ?? '/holo';
  const scopeLines = [...SLACK_INGEST_SCOPES, ...SLACK_BOT_SCOPES]
    .map((s) => `      - ${s}`)
    .join('\n');

  return `display_information:
  name: ${opts.displayName}
features:
  app_home:
    home_tab_enabled: false
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  bot_user:
    display_name: ${opts.displayName}
    always_online: true
  slash_commands:
    - command: ${slashCommand}
      url: ${opts.slashCommandsUrl}
      description: Ask Holo a question
      usage_hint: "[your question]"
      should_escape: false
oauth_config:
  redirect_urls:
    - ${opts.oauthRedirectUrl}
  scopes:
    bot:
${scopeLines}
settings:
  event_subscriptions:
    request_url: ${opts.eventsRequestUrl}
    bot_events:
      - app_mention
      - message.im
  interactivity:
    is_enabled: ${opts.interactivityUrl ? 'true' : 'false'}${opts.interactivityUrl ? `\n    request_url: ${opts.interactivityUrl}` : ''}
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
`;
}
