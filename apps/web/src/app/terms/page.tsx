export const metadata = {
  title: 'Terms of Service — holo',
  description: 'The terms governing use of the holo managed service at holobase.dev.',
};

const LAST_UPDATED = 'May 18, 2026';
const CONTACT_EMAIL = 'support@holobase.dev';

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8 p-12">
      <header className="space-y-2">
        <span className="caption">Legal</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">
          Terms of Service
        </h1>
        <p className="text-[13px] text-text-subtle">Last updated: {LAST_UPDATED}</p>
      </header>

      <Section title="Provider">
        The managed service at holobase.dev and related domains is operated by:
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

      <Section title="The service">
        Holo is an open-source context layer for AI agents. These terms govern
        use of the managed service. The underlying software is separately
        licensed under MIT and can be self-hosted; self-hosted deployments are
        not covered by these terms.
      </Section>

      <Section title="Accounts">
        You need an account to use the service. You are responsible for the
        accuracy of the information you provide, for keeping your credentials
        secure, and for all activity under your account. You must be
        authorized by your organization to connect the tools and accounts you
        connect.
      </Section>

      <Section title="Your content and connected data">
        You retain all rights to the content holo indexes from your connected
        tools. You grant us the limited, non-exclusive right to process that
        content as required to operate the service &mdash; running syncs,
        computing embeddings, and serving retrieval queries to the agents you
        authorize. We do not use your content to train foundation models.
      </Section>

      <Section title="Intellectual property">
        We retain all rights, title, and interest in the service, including the
        holobase.dev brand, the managed-service infrastructure, and any
        improvements we make. The MIT-licensed source code is governed by the
        MIT License and remains free for you to use, modify, and self-host.
      </Section>

      <Section title="Acceptable use">
        You may not use the service to violate any law, infringe others&apos;
        rights, attack or attempt to circumvent the security of the service,
        or reverse-engineer infrastructure beyond what the MIT-licensed source
        already discloses. You may not use the service to process data you are
        not authorized to access in the source systems.
      </Section>

      <Section title="Third-party services">
        Holo connects to third-party tools at your direction and forwards
        retrieved context to the LLM providers your agents use. Your use of
        those services remains governed by their own terms.
      </Section>

      <Section title="Data processing addendum">
        Where you process personal data through the service as a controller
        under the GDPR, our processing on your behalf is governed by our Data
        Processing Addendum, available on request at {CONTACT_EMAIL}.
      </Section>

      <Section title="Availability and changes">
        We aim to keep the service available but do not guarantee uninterrupted
        operation. We may change, suspend, or discontinue features with
        reasonable notice for material changes.
      </Section>

      <Section title="Termination">
        You may stop using the service and delete your organization at any
        time from the dashboard. We may suspend or terminate accounts that
        violate these terms. Upon termination, your data is deleted in
        accordance with the retention schedule in our Privacy Policy.
      </Section>

      <Section title="Disclaimer">
        The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;
        without warranties of any kind, whether express or implied, including
        warranties of merchantability, fitness for a particular purpose, or
        non-infringement. We do not warrant that retrieval results will be
        accurate, complete, or fit for any particular use.
      </Section>

      <Section title="Limitation of liability">
        To the maximum extent permitted by law, our aggregate liability arising
        from or related to the service is limited to the fees you paid us in
        the twelve months preceding the claim, or, if none, one hundred euros.
        We are not liable for indirect, incidental, consequential, or punitive
        damages. Nothing in these terms limits liability that cannot be
        excluded under mandatory law (including liability for intent or gross
        negligence).
      </Section>

      <Section title="Indemnification">
        You agree to indemnify and hold m12k GmbH harmless from third-party
        claims arising out of your breach of these terms, your misuse of the
        service, or content you cause the service to process in violation of
        applicable law or third-party rights.
      </Section>

      <Section title="Force majeure">
        Neither party is liable for delays or failures caused by events beyond
        its reasonable control, including outages of upstream providers,
        network failures, or governmental action.
      </Section>

      <Section title="Assignment">
        You may not assign these terms without our prior written consent. We
        may assign these terms in connection with a merger, acquisition, or
        sale of substantially all our assets.
      </Section>

      <Section title="Governing law and jurisdiction">
        These terms are governed by the laws of the Federal Republic of
        Germany, excluding its conflict-of-laws rules and the UN Convention on
        Contracts for the International Sale of Goods. Exclusive place of
        jurisdiction for disputes arising from these terms is Heidenheim,
        Germany, to the extent permitted by law. Mandatory consumer
        protection rights remain unaffected.
      </Section>

      <Section title="Severability and entire agreement">
        If any provision of these terms is held unenforceable, the remaining
        provisions remain in full effect. These terms, together with our
        Privacy Policy and any DPA we sign with you, constitute the entire
        agreement between you and m12k GmbH regarding the service.
      </Section>

      <Section title="Changes to these terms">
        We may update these terms; the &ldquo;Last updated&rdquo; date above
        reflects the current version. Material changes will be communicated to
        active organizations with reasonable advance notice.
      </Section>

      <Section title="Contact">
        Questions about these terms: {CONTACT_EMAIL}.
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
