'use client';

import { useState, useEffect, useCallback } from 'react';
import { Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface Proposal {
  id: string;
  proposedName: string;
  summary: string;
  artifactCount: number;
  entityKey?: string;
  proposedSlug: string;
}

interface ProposalCardState {
  busy: boolean;
  error: string | null;
  editingSlug: boolean;
  slug: string;
  removed: boolean;
  confirmed: boolean;
}

function useProposalState(initial: Proposal): [ProposalCardState, React.Dispatch<React.SetStateAction<ProposalCardState>>] {
  const [state, setState] = useState<ProposalCardState>({
    busy: false,
    error: null,
    editingSlug: false,
    slug: initial.proposedSlug,
    removed: false,
    confirmed: false,
  });
  return [state, setState];
}

function ProposalCard({
  proposal,
  onRemove,
}: {
  proposal: Proposal;
  onRemove: (id: string) => void;
}) {
  const [state, setState] = useProposalState(proposal);

  function setSlug(slug: string) {
    setState((s) => ({ ...s, slug }));
  }
  function toggleEdit() {
    setState((s) => ({ ...s, editingSlug: !s.editingSlug, error: null }));
  }

  async function accept() {
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const res = await fetch(`/api/skills/proposals/${proposal.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finalSlug: state.slug }),
      });
      if (res.ok) {
        setState((s) => ({ ...s, busy: false, confirmed: true }));
        // Brief pause so user sees confirmation, then remove
        setTimeout(() => onRemove(proposal.id), 1200);
      } else {
        const data = await res.json() as { problem?: string };
        setState((s) => ({ ...s, busy: false, error: data.problem ?? 'Accept failed. Try again.' }));
      }
    } catch {
      setState((s) => ({ ...s, busy: false, error: 'Network error. Try again.' }));
    }
  }

  async function reject() {
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const res = await fetch(`/api/skills/proposals/${proposal.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        onRemove(proposal.id);
      } else {
        const data = await res.json() as { problem?: string };
        setState((s) => ({ ...s, busy: false, error: data.problem ?? 'Reject failed. Try again.' }));
      }
    } catch {
      setState((s) => ({ ...s, busy: false, error: 'Network error. Try again.' }));
    }
  }

  if (state.confirmed) {
    return (
      <div className="rounded-md border border-border bg-surface px-5 py-4">
        <p className="text-[13px] text-success">Skill synthesized. Reload to see it in the table.</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-surface px-5 py-4 space-y-3">
      {/* Heading */}
      <div className="space-y-1">
        <h3 className="font-sans text-[18px] leading-7 font-semibold text-text tracking-[-0.01em]">
          {proposal.proposedName}
        </h3>
        <p className="text-[13px] leading-5 text-text-muted">{proposal.summary}</p>
      </div>

      {/* Metadata chips */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="neutral">{proposal.artifactCount} artifact{proposal.artifactCount !== 1 ? 's' : ''}</Badge>
        {proposal.entityKey && (
          <Badge variant="neutral">{proposal.entityKey}</Badge>
        )}
      </div>

      {/* Slug row */}
      <div className="flex items-center gap-2">
        {state.editingSlug ? (
          <input
            type="text"
            value={state.slug}
            onChange={(e) => setSlug(e.target.value)}
            autoFocus
            className="rounded-sm border border-border bg-transparent px-2 py-0.5 font-mono text-[12px] text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent w-64"
          />
        ) : (
          <span className="font-mono text-[12px] text-text-subtle">
            slug: {state.slug}
          </span>
        )}
        <button
          type="button"
          onClick={toggleEdit}
          disabled={state.busy}
          className="text-text-subtle hover:text-text transition-colors duration-micro disabled:opacity-50"
          aria-label="Edit slug"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="primary"
          size="sm"
          onClick={accept}
          disabled={state.busy || !state.slug.trim()}
        >
          {state.busy ? 'Working…' : 'Accept'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={reject}
          disabled={state.busy}
          className="text-text-muted hover:text-text"
        >
          Reject
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleEdit}
          disabled={state.busy}
          className="text-text-muted hover:text-text"
        >
          Rename
        </Button>
      </div>

      {state.error && (
        <p className="text-[12px] text-error">{state.error}</p>
      )}
    </div>
  );
}

export function SuggestedProcedures() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  const fetchProposals = useCallback(async () => {
    setFetchError(null);
    try {
      const res = await fetch('/api/skills/proposals');
      if (res.ok) {
        const data = await res.json() as Proposal[];
        setProposals(data);
      } else {
        setFetchError('Failed to load suggestions.');
      }
    } catch {
      setFetchError('Network error loading suggestions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProposals();
  }, [fetchProposals]);

  async function discover() {
    setDiscovering(true);
    setDiscoverError(null);
    try {
      const res = await fetch('/api/skills/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        setLoading(true);
        await fetchProposals();
      } else {
        const data = await res.json() as { problem?: string };
        setDiscoverError(data.problem ?? 'Discovery failed. Try again.');
      }
    } catch {
      setDiscoverError('Network error. Try again.');
    } finally {
      setDiscovering(false);
    }
  }

  function removeProposal(id: string) {
    setProposals((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <span className="caption text-text-subtle uppercase tracking-[0.04em] text-[12px] font-medium">
            Suggested procedures
          </span>
          <p className="text-[13px] leading-5 text-text-muted">
            Holo clusters your team&apos;s recent work into procedure candidates. Review and confirm what to learn from.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Button
            variant="primary"
            size="sm"
            onClick={discover}
            disabled={discovering}
            className="whitespace-nowrap"
          >
            {discovering ? 'Scanning artifacts…' : 'Discover now'}
          </Button>
          {discoverError && (
            <p className="text-[12px] text-error text-right max-w-48">{discoverError}</p>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="rounded-md border border-border bg-surface px-5 py-8 text-center">
          <p className="text-[13px] text-text-subtle">Loading…</p>
        </div>
      ) : fetchError ? (
        <div className="rounded-md border border-border bg-surface px-5 py-8 text-center">
          <p className="text-[13px] text-error">{fetchError}</p>
        </div>
      ) : proposals.length === 0 ? (
        <div className="rounded-md border border-border bg-surface px-5 py-8 text-center">
          <p className="text-[13px] text-text-muted">
            No suggestions yet. Click Discover to scan recent artifacts, or wait for the nightly run.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              onRemove={removeProposal}
            />
          ))}
        </div>
      )}
    </div>
  );
}
