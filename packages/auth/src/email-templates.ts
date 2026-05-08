// Email templates rendered to inlined-style HTML — email clients (Gmail,
// Outlook, Apple Mail) strip <style> tags and block web fonts, so every rule
// is inline and the type stack is system-fonts only. Layout uses tables for
// Outlook compatibility; modern clients render them just like divs.
//
// Design tokens come from DESIGN.md (light surfaces, accent #3F47FF). We
// intentionally keep this minimal — one card, one CTA, no decoration.

interface CtaButton {
  label: string;
  url: string;
}

interface EmailShellArgs {
  preheader: string;
  title: string;
  bodyHtml: string;
  cta?: CtaButton;
  footerHtml: string;
}

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function renderShell({ preheader, title, bodyHtml, cta, footerHtml }: EmailShellArgs): string {
  const ctaHtml = cta
    ? `
        <tr>
          <td style="padding: 8px 32px 0 32px;">
            <a href="${escapeHtml(cta.url)}"
               style="display: inline-block; background: #3F47FF; color: #FFFFFF; text-decoration: none; font-weight: 500; font-size: 14px; line-height: 20px; padding: 10px 18px; border-radius: 6px; mso-padding-alt: 0;">
              ${escapeHtml(cta.label)}
            </a>
          </td>
        </tr>`
    : '';

  // Preheader = the snippet preview Gmail/Apple Mail show next to the subject.
  // Hidden via display:none + zero metrics; still parsed by the inbox preview.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin: 0; padding: 0; background: #FAFAF7; color: #0A0A0A; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 24px; -webkit-font-smoothing: antialiased;">
<div style="display: none; font-size: 1px; line-height: 1px; max-height: 0; max-width: 0; opacity: 0; overflow: hidden; mso-hide: all;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #FAFAF7;">
  <tr>
    <td align="center" style="padding: 48px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 520px; background: #FFFFFF; border: 1px solid #E4E4E7; border-radius: 8px;">
        <tr>
          <td style="padding: 32px 32px 0 32px;">
            <div style="font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: #71717A;">holo</div>
          </td>
        </tr>
        <tr>
          <td style="padding: 16px 32px 0 32px;">
            <h1 style="margin: 0; font-size: 24px; line-height: 32px; font-weight: 600; letter-spacing: -0.01em; color: #0A0A0A;">${escapeHtml(title)}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding: 16px 32px 0 32px; font-size: 15px; line-height: 24px; color: #0A0A0A;">
            ${bodyHtml}
          </td>
        </tr>
        ${ctaHtml}
        <tr>
          <td style="padding: 32px;">
            <hr style="border: none; border-top: 1px solid #E4E4E7; margin: 0 0 16px 0;" />
            <div style="font-size: 13px; line-height: 20px; color: #71717A;">
              ${footerHtml}
            </div>
          </td>
        </tr>
      </table>
      <div style="max-width: 520px; margin: 16px auto 0 auto; font-size: 12px; line-height: 16px; color: #A1A1AA; text-align: center;">
        Holo · Open-source MCP context layer for AI agents
      </div>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export interface InvitationEmailArgs {
  inviterName: string;
  organizationName: string;
  acceptUrl: string;
}

export function renderInvitationEmail(args: InvitationEmailArgs): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `${args.inviterName} invited you to ${args.organizationName} on Holo`;
  const text =
    `${args.inviterName} invited you to join the "${args.organizationName}" workspace on Holo.\n\n` +
    `Accept the invite:\n${args.acceptUrl}\n\n` +
    `If you didn't expect this, you can safely ignore this email.`;

  const bodyHtml = `
    <p style="margin: 0;">
      <strong style="color: #0A0A0A;">${escapeHtml(args.inviterName)}</strong>
      invited you to join the
      <strong style="color: #0A0A0A;">${escapeHtml(args.organizationName)}</strong>
      workspace on Holo. Accept to get access to the same connections, skills, and observability your team uses.
    </p>`;

  const html = renderShell({
    preheader: `${args.inviterName} invited you to ${args.organizationName} on Holo`,
    title: `You're invited to ${args.organizationName}`,
    bodyHtml,
    cta: { label: 'Accept invite', url: args.acceptUrl },
    footerHtml:
      `If the button doesn't work, paste this URL into your browser:<br />` +
      `<a href="${escapeHtml(args.acceptUrl)}" style="color: #3F47FF; word-break: break-all;">${escapeHtml(args.acceptUrl)}</a>` +
      `<br /><br />Didn't expect this invite? You can safely ignore this email.`,
  });

  return { subject, text, html };
}

export interface OtpEmailArgs {
  otp: string;
  expiresInMinutes?: number;
}

export function renderOtpEmail(args: OtpEmailArgs): {
  subject: string;
  text: string;
  html: string;
} {
  const expiresIn = args.expiresInMinutes ?? 5;
  const subject = `Your Holo sign-in code: ${args.otp}`;
  const text =
    `Your Holo sign-in code is ${args.otp}.\n\n` +
    `It expires in ${expiresIn} minutes. If you didn't request this, you can ignore this email.`;

  const bodyHtml = `
    <p style="margin: 0 0 20px 0;">Use this code to finish signing in to Holo.</p>
    <div style="display: inline-block; font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 28px; line-height: 36px; letter-spacing: 0.18em; font-weight: 500; background: #F4F4F0; border: 1px solid #E4E4E7; border-radius: 6px; padding: 14px 22px; color: #0A0A0A;">
      ${escapeHtml(args.otp)}
    </div>`;

  const html = renderShell({
    preheader: `Your Holo sign-in code: ${args.otp}`,
    title: 'Your sign-in code',
    bodyHtml,
    footerHtml:
      `This code expires in ${expiresIn} minutes. ` +
      `If you didn't request a sign-in, you can safely ignore this email.`,
  });

  return { subject, text, html };
}
