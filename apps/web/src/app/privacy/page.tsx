export const metadata = {
  title: 'Privacy Policy — holo',
  description:
    'How holo handles the data you connect, index, and query through the platform.',
};

const LAST_UPDATED = 'May 18, 2026';
const CONTACT_EMAIL = 'privacy@holobase.dev';

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 p-12">
      <header className="space-y-2">
        <span className="caption">Legal</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">
          Privacy Policy
        </h1>
        <p className="text-[13px] text-text-subtle">Last updated: {LAST_UPDATED}</p>
      </header>

      <Section title="Controller">
        <p>
          The controller for personal data processed by the managed service at
          holobase.dev is:
        </p>
        <p className="mt-3">
          m12k GmbH
          <br />
          Seligerstraße 47
          <br />
          89537 Giengen, Germany
          <br />
          <span className="text-text-subtle">Contact: {CONTACT_EMAIL}</span>
        </p>
      </Section>

      <Section title="What holo is">
        Holo is an open-source context layer for AI agents. The managed service
        at holobase.dev hosts an instance for your organization that connects
        to your existing tools (e.g. GitHub, Slack, Notion, Google Drive,
        Google Chat, Linear, Microsoft Teams), indexes the content you grant
        access to, and exposes that index to AI agents (Claude, Cursor,
        ChatGPT, and our own chat surfaces) through the Model Context Protocol.
      </Section>

      <Section title="Data we process">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Account data:</strong> your email, name, organization, and
            role, used to authenticate you and scope access.
          </li>
          <li>
            <strong>Connector credentials:</strong> OAuth tokens, API keys, or
            service-account keys you provide to authorize holo to read from
            your third-party tools. Stored encrypted at rest.
          </li>
          <li>
            <strong>Indexed content:</strong> messages, documents, issues,
            files, and metadata fetched from your connected sources, plus
            vector embeddings derived from that content. We preserve the
            original access-control lists so a user only retrieves content they
            could already see in the source system.
          </li>
          <li>
            <strong>Operational logs:</strong> sync job status, query traces,
            and error logs used to operate and debug the service.
          </li>
        </ul>
      </Section>

      <Section title="Legal basis (GDPR Art. 6)">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Performance of contract (Art. 6(1)(b)):</strong> processing
            account data, connector credentials, and indexed content to provide
            the service you signed up for.
          </li>
          <li>
            <strong>Legitimate interest (Art. 6(1)(f)):</strong> operational
            logs and error traces for security, abuse prevention, and
            reliability.
          </li>
          <li>
            <strong>Consent (Art. 6(1)(a)):</strong> for any optional features
            you explicitly enable that go beyond providing the core service.
          </li>
        </ul>
      </Section>

      <Section title="Subprocessors">
        We use the following subprocessors to operate the service:
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            <strong>Railway (Railway Corp., USA):</strong> application hosting,
            managed Postgres, managed Redis.
          </li>
          <li>
            <strong>Anthropic (USA):</strong> LLM inference when an agent
            configured for Claude queries the index.
          </li>
          <li>
            <strong>OpenAI (USA):</strong> LLM inference and embedding
            generation.
          </li>
          <li>
            <strong>Google (USA):</strong> LLM inference when an agent
            configured for Gemini queries the index, and identity/authorization
            when you connect Google Workspace tools (Drive, Chat).
          </li>
        </ul>
        <p className="mt-3">
          An up-to-date list is available on request at {CONTACT_EMAIL}.
        </p>
      </Section>

      <Section title="International data transfers">
        Our subprocessors are based in the United States. Transfers are made
        on the basis of the European Commission&apos;s Standard Contractual
        Clauses (SCCs) and, where applicable, the EU&ndash;US Data Privacy
        Framework certification of the receiving party. Indexed content is
        only forwarded to an LLM provider when one of your agents issues a
        query that requires it.
      </Section>

      <Section title="How we use it">
        We process the data above only to provide the service: running
        connector syncs, answering retrieval queries from your agents, and
        keeping the system reliable. We do not sell your data, do not train
        foundation models on it, and do not share it with third parties for
        advertising.
      </Section>

      <Section title="Security">
        We protect your data with industry-standard measures including
        TLS&nbsp;1.2+ for all data in transit, encryption at rest for
        credentials and the managed database, scoped access controls, and
        environment isolation between organizations. Access to production
        systems is limited to authorized personnel and audited. No system is
        perfectly secure; if you discover a vulnerability please report it to
        {' '}{CONTACT_EMAIL}.
      </Section>

      <Section title="Retention and deletion">
        Indexed content and embeddings are retained while the corresponding
        connector is active. Disconnecting a connector deletes the credentials
        immediately and queues the indexed content for deletion. Deleting your
        organization removes all associated data within 30&nbsp;days.
        Operational logs are retained for up to 90&nbsp;days.
      </Section>

      <Section title="Cookies and tracking">
        We use only the cookies strictly necessary to keep you signed in and
        to operate the service. We do not run third-party analytics, marketing
        pixels, or cross-site tracking.
      </Section>

      <Section title="Data breach notification">
        If we become aware of a personal-data breach affecting your data we
        will notify the competent supervisory authority within 72&nbsp;hours
        and, where required, notify affected users without undue delay, in
        line with GDPR Art.&nbsp;33 and&nbsp;34.
      </Section>

      <Section title="Your rights">
        Under the GDPR you have the right to access, rectify, erase, restrict
        or object to processing of your personal data, and the right to data
        portability. Exercise any of these by emailing {CONTACT_EMAIL}. You
        also have the right to lodge a complaint with the competent
        supervisory authority &mdash; for m12k GmbH this is:
        <p className="mt-3">
          Der Landesbeauftragte für den Datenschutz und die Informationsfreiheit
          Baden-Württemberg
          <br />
          Königstraße 10a, 70173 Stuttgart, Germany
        </p>
      </Section>

      <Section title="Self-hosting">
        Holo is MIT-licensed and can be self-hosted. When self-hosted, this
        policy does not apply &mdash; your organization is the data controller
        for your own deployment.
      </Section>

      <Section title="Changes">
        We may update this policy; the &ldquo;Last updated&rdquo; date above
        reflects the current version. Material changes will be communicated to
        active organizations.
      </Section>

      <Section title="Contact">
        Questions about this policy: {CONTACT_EMAIL}.
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-h3 font-semibold tracking-tight">{title}</h2>
      <div className="text-[15px] leading-6 text-text-muted">{children}</div>
    </section>
  );
}
