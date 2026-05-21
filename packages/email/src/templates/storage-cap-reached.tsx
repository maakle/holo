import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export interface StorageCapReachedProps {
  organizationName: string;
  currentPlanName: string;
  currentCount: number;
  limit: number;
  suggestedUpgradePlanName: string;
  upgradeUrl: string;
}

/**
 * Sent the first time an org's sync is paused because its `chunks` row count
 * crossed `maxStoredArtifacts`. Idempotency key shape:
 *   `storage_cap_reached:<org_id>:<period_start_iso>`
 * so a fresh email goes out each billing period if the org is still over
 * — but they're not spammed within a period.
 *
 * Visual posture mirrors `packages/auth/src/email-templates.ts`: light
 * surfaces, single accent for the CTA, no decoration. Email clients (Gmail
 * dark mode in particular) strip CSS variables and web fonts; React Email's
 * components handle the inlining + table fallback for Outlook.
 */
export function StorageCapReached({
  organizationName,
  currentPlanName,
  currentCount,
  limit,
  suggestedUpgradePlanName,
  upgradeUrl,
}: StorageCapReachedProps) {
  const preview = `${organizationName} has reached its ${currentPlanName} plan limit on indexed items — new ingestion is paused.`;
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={{ padding: '32px 32px 0' }}>
            <Text style={brand}>holo</Text>
          </Section>
          <Section style={{ padding: '16px 32px 0' }}>
            <Heading as="h1" style={heading}>
              Your search index is full
            </Heading>
          </Section>
          <Section style={{ padding: '16px 32px 0' }}>
            <Text style={paragraph}>
              <strong style={{ color: '#0A0A0A' }}>{organizationName}</strong> has hit the{' '}
              <strong style={{ color: '#0A0A0A' }}>{currentPlanName}</strong> plan&apos;s
              limit on indexed items —{' '}
              <strong style={{ color: '#0A0A0A' }}>{currentCount.toLocaleString('en-US')}</strong>{' '}
              of {limit.toLocaleString('en-US')} used. New connector syncs are paused;
              your existing index stays fully searchable.
            </Text>
            <Text style={paragraph}>
              Upgrade to{' '}
              <strong style={{ color: '#0A0A0A' }}>{suggestedUpgradePlanName}</strong>{' '}
              to resume ingestion and keep your team&apos;s context fresh.
            </Text>
          </Section>
          <Section style={{ padding: '8px 32px 0' }}>
            {/* Inline anchor instead of @react-email/components <Button>: keeps the
             *  whole template in plain elements so the text-mode render is clean. */}
            <Link href={upgradeUrl} style={cta}>
              View plans
            </Link>
          </Section>
          <Section style={{ padding: '32px' }}>
            <Hr style={hr} />
            <Text style={footer}>
              You&apos;re receiving this because you&apos;re the owner of{' '}
              {organizationName} on Holo. Adjust notification settings from{' '}
              <Link href={upgradeUrl} style={footerLink}>
                Settings → Billing
              </Link>
              .
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// Style objects — inlined by @react-email/render so no <style> tags ship.
const body: React.CSSProperties = {
  margin: 0,
  padding: 0,
  background: '#FAFAF7',
  color: '#0A0A0A',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  fontSize: '15px',
  lineHeight: '24px',
};

const container: React.CSSProperties = {
  maxWidth: '520px',
  margin: '48px auto',
  background: '#FFFFFF',
  border: '1px solid #E4E4E7',
  borderRadius: '8px',
};

const brand: React.CSSProperties = {
  margin: 0,
  fontSize: '12px',
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#71717A',
};

const heading: React.CSSProperties = {
  margin: 0,
  fontSize: '24px',
  lineHeight: '32px',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  color: '#0A0A0A',
};

const paragraph: React.CSSProperties = {
  margin: '0 0 16px 0',
  fontSize: '15px',
  lineHeight: '24px',
  color: '#0A0A0A',
};

const cta: React.CSSProperties = {
  display: 'inline-block',
  background: '#3F47FF',
  color: '#FFFFFF',
  textDecoration: 'none',
  fontWeight: 500,
  fontSize: '14px',
  lineHeight: '20px',
  padding: '10px 18px',
  borderRadius: '6px',
};

const hr: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid #E4E4E7',
  margin: '0 0 16px 0',
};

const footer: React.CSSProperties = {
  margin: 0,
  fontSize: '13px',
  lineHeight: '20px',
  color: '#71717A',
};

const footerLink: React.CSSProperties = {
  color: '#3F47FF',
};
