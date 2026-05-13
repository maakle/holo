/**
 * RFC-0006 — Pre-Call Account Brief.
 *
 * Linkable, bookmarkable artifact at /brief/<account-id>?context=…. The page
 * renders the same five-section structured payload that the MCP tool and
 * REST `/v1/accounts/:id/brief` return — we share `runGetAccountBriefTool`
 * directly rather than going through the REST layer so the page can call it
 * on the server and stream per-section as the synthesis completes.
 *
 * Design system notes (DESIGN.md):
 *  - Dark-mode primary; warm-white type on near-black background.
 *  - Accent (`#3F47FF` / `--accent`) used SPARINGLY: only the regenerate
 *    button, the active context tab, the "loaded from cache" badge, plus
 *    the section-heading bar. That's 4 uses — within the 3-5 budget.
 *  - Tier / ARR / owner sit in the at-a-glance card using the existing
 *    Card primitive. Numerics render with `tabular-nums`.
 *  - No decorative blobs, no gradients. Empty sections render the literal
 *    "No signal in the last 30 days" string per RFC.
 */
import { Suspense } from 'react';
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  runGetAccountBriefTool,
  sectionOrderFor,
  BRIEF_CONTEXTS,
  type AccountBrief,
  type BriefContext,
  type BriefSection,
  type BriefAtGlance,
} from '@holo/agent-tools';
import { getSubjectsForUser } from '@holo/user-subjects';
import { RegenerateButton } from './_components/regenerate-button';

// Force-dynamic — the brief is per-user, per-day, and may hit live
// connectors via `searchWithCoverage`. Static caching would conflict with
// the per-day cache shape and the freshness chips would lie.
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ context?: string; customContext?: string }>;
}

export default async function BriefPage({ params, searchParams }: PageProps) {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const orgId = resolveActiveOrgId(session);
  if (!orgId) redirect('/sign-in');

  const { accountId } = await params;
  const sp = await searchParams;
  const context = normalizeContext(sp.context);
  const customContext = sp.customContext?.trim() || undefined;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2">
        <span className="caption">Brief</span>
        <ContextTabs accountId={accountId} active={context} />
      </header>

      <Suspense fallback={<BriefSkeleton />}>
        <BriefBody
          db={db}
          orgId={orgId}
          userId={session.user.id}
          accountId={accountId}
          context={context}
          customContext={customContext}
        />
      </Suspense>
    </div>
  );
}

// ── Body ────────────────────────────────────────────────────────────────────

async function BriefBody({
  db,
  orgId,
  userId,
  accountId,
  context,
  customContext,
}: {
  db: ReturnType<typeof getServerContext> extends Promise<infer T>
    ? T extends { db: infer D }
      ? D
      : never
    : never;
  orgId: string;
  userId: string;
  accountId: string;
  context: BriefContext;
  customContext: string | undefined;
}) {
  const extraSubjects = await getSubjectsForUser(db, userId);
  const brief: AccountBrief = await runGetAccountBriefTool(
    {
      db,
      organizationId: orgId,
      userId,
      userSubjects: [`org:${orgId}`, `user:${userId}`, ...extraSubjects],
    },
    {
      account_id: accountId,
      context,
      ...(customContext ? { custom_context: customContext } : {}),
    },
  );

  // Empty displayName is our "no access / not found" signal — see
  // `emptyBrief` in get-account-brief.ts. The RFC frames this as a 403,
  // but on the web surface a 404 is the friendlier UX (the user copied
  // a stale link rather than tried to bypass ACL).
  if (brief.sections.atGlance.displayName === '') {
    notFound();
  }

  const order = sectionOrderFor(context);

  return (
    <>
      <BriefHeader brief={brief} accountId={accountId} context={context} />
      <div className="space-y-4">
        {order.map((id) => (
          <SectionRenderer key={id} id={id} section={brief.sections[id]} />
        ))}
      </div>
    </>
  );
}

function BriefHeader({
  brief,
  accountId,
  context,
}: {
  brief: AccountBrief;
  accountId: string;
  context: BriefContext;
}) {
  const ag = brief.sections.atGlance;
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="font-display text-h1 font-semibold tracking-tight">
          {ag.displayName}
        </h1>
        <div className="flex items-center gap-2">
          {brief.fromCache ? (
            <span
              className="rounded-sm border border-accent/40 px-2 py-0.5 text-[11px] font-medium tracking-[0.04em] text-accent"
              title={`Cached from ${brief.generatedAt}`}
            >
              CACHED
            </span>
          ) : null}
          <RegenerateButton accountId={accountId} context={context} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-[13px] leading-5 text-text-muted tabular-nums">
        <FreshnessChips freshness={brief.freshness} />
        <span className="text-text-subtle">
          Generated {formatTimestamp(brief.generatedAt)}
        </span>
      </div>
    </div>
  );
}

function FreshnessChips({ freshness }: { freshness: AccountBrief['freshness'] }) {
  const entries = Object.entries(freshness.perProvider) as Array<
    [keyof AccountBrief['freshness']['perProvider'], string | null]
  >;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([provider, ts]) => (
        <span
          key={provider}
          className={
            ts
              ? 'inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium tracking-[0.04em] text-text-muted'
              : 'inline-flex items-center gap-1.5 rounded-sm border border-border px-2 py-0.5 text-[11px] font-medium tracking-[0.04em] text-text-subtle'
          }
        >
          <span className="uppercase">{provider}</span>
          <span className="tabular-nums">{ts ? formatTimestamp(ts) : '—'}</span>
        </span>
      ))}
    </div>
  );
}

function SectionRenderer({
  id,
  section,
}: {
  id: keyof AccountBrief['sections'];
  section: AccountBrief['sections'][keyof AccountBrief['sections']];
}) {
  if (id === 'atGlance') {
    return <AtGlanceCard section={section as BriefAtGlance} />;
  }
  return <NarrativeSection title={titleFor(id)} section={section as BriefSection} />;
}

function AtGlanceCard({ section }: { section: BriefAtGlance }) {
  // The at-a-glance card is the only place tier/ARR/owner render. Per
  // DESIGN.md numerics use tabular-nums; per RFC missing values render
  // as "—" with a tooltip rather than fabricating $0.
  return (
    <Card>
      <CardHeader>
        <CardTitle>At a glance</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] leading-5 sm:grid-cols-4">
          <Field label="Tier" value={section.tier ?? '—'} muted={!section.tier} />
          <Field
            label="ARR"
            value={
              section.arr
                ? `${section.arr.currency} ${section.arr.amount}`
                : '—'
            }
            muted={!section.arr}
            tabular
          />
          <Field label="Owner" value={section.owner ?? '—'} muted={!section.owner} />
          <Field
            label="Account age"
            value={
              section.accountAgeDays !== null
                ? `${section.accountAgeDays} days`
                : '—'
            }
            muted={section.accountAgeDays === null}
            tabular
          />
        </dl>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  muted,
  tabular,
}: {
  label: string;
  value: string;
  muted?: boolean;
  tabular?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="caption">{label}</dt>
      <dd
        className={
          (muted ? 'text-text-subtle' : 'text-text') +
          ' text-[15px] leading-6' +
          (tabular ? ' tabular-nums' : '')
        }
        title={muted ? 'Not synced — connect or update the source record' : undefined}
      >
        {value}
      </dd>
    </div>
  );
}

function NarrativeSection({ title, section }: { title: string; section: BriefSection }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {section.claims.length === 0 ? (
          <p className="text-[13px] leading-5 text-text-subtle">
            No signal in the last 30 days.
          </p>
        ) : (
          <ul className="space-y-2 text-[15px] leading-6 text-text">
            {section.claims.map((claim, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1 size-1 rounded-full bg-text-subtle" aria-hidden />
                <span>
                  {claim.text}{' '}
                  {claim.citationRefs.map((ref) => (
                    <CitationChip
                      key={ref}
                      citation={section.citations[ref - 1]}
                      index={ref}
                    />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CitationChip({
  citation,
  index,
}: {
  citation: BriefSection['citations'][number] | undefined;
  index: number;
}) {
  if (!citation) {
    return (
      <span className="inline-block rounded-sm border border-border px-1 text-[11px] text-text-subtle">
        [{index}]
      </span>
    );
  }
  if (citation.url) {
    return (
      <a
        href={citation.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block rounded-sm border border-border bg-surface-2 px-1 text-[11px] tabular-nums text-text-muted hover:border-border-strong hover:text-text"
        title={`${citation.label} — ${citation.snippet}`}
      >
        [{index}]
      </a>
    );
  }
  return (
    <span
      className="inline-block rounded-sm border border-border bg-surface-2 px-1 text-[11px] tabular-nums text-text-muted"
      title={`${citation.label} — ${citation.snippet}`}
    >
      [{index}]
    </span>
  );
}

function ContextTabs({
  accountId,
  active,
}: {
  accountId: string;
  active: BriefContext;
}) {
  return (
    <nav className="flex flex-wrap items-center gap-1 text-[13px] leading-5">
      {BRIEF_CONTEXTS.filter((c) => c !== 'custom').map((c) => (
        <a
          key={c}
          href={`/brief/${accountId}?context=${c}`}
          className={
            c === active
              ? 'rounded-md border-b-2 border-accent px-2 py-1 font-medium text-text'
              : 'rounded-md px-2 py-1 text-text-muted hover:bg-surface-2'
          }
        >
          {labelFor(c)}
        </a>
      ))}
    </nav>
  );
}

function BriefSkeleton() {
  // Three card placeholders — enough to telegraph "stuff is loading" without
  // pretending we know the exact shape. Streaming Suspense replaces these.
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardContent>
            <div className="space-y-2 py-2">
              <div className="h-3 w-1/3 rounded bg-surface-2" />
              <div className="h-3 w-3/4 rounded bg-surface-2" />
              <div className="h-3 w-2/3 rounded bg-surface-2" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizeContext(raw: string | undefined): BriefContext {
  // Default to check-in — RFC-0006 calls this the safe fallback. We never
  // promote a custom string to a context here; that path goes through the
  // skill template, which sets `context = 'custom'` explicitly.
  const allowed = new Set<string>(BRIEF_CONTEXTS as readonly string[]);
  if (raw && allowed.has(raw)) return raw as BriefContext;
  return 'check-in';
}

function labelFor(c: BriefContext): string {
  switch (c) {
    case 'renewal':
      return 'Renewal';
    case 'upsell':
      return 'Upsell';
    case 'check-in':
      return 'Check-in';
    case 'objection':
      return 'Objection';
    case 'first-meeting':
      return 'First meeting';
    case 'custom':
      return 'Custom';
  }
}

function titleFor(id: keyof AccountBrief['sections']): string {
  switch (id) {
    case 'atGlance':
      return 'At a glance';
    case 'issues':
      return 'Open and recent issues';
    case 'lastConversation':
      return 'Last conversation';
    case 'productAsks':
      return "What they've asked for";
    case 'contextSection':
      return 'Context for this meeting';
  }
}

function formatTimestamp(iso: string): string {
  // Bare ISO is fine on the server (the chip is small). The web layer is
  // dark-mode primary; we don't try to localize here — that's a follow-up
  // when we add per-user timezone in settings.
  return iso.replace('T', ' ').slice(0, 16);
}
