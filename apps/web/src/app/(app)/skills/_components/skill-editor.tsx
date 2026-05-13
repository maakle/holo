'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { parseSkill, serializeSkill } from '@holo/skills';
import type { SkillDoc, SkillDefaults } from '@holo/skills';
import { Button } from '@/components/ui/button';

type Mode = 'form' | 'body' | 'yaml';

interface Props {
  slug: string;
  initialContent: string;
  canPromote: boolean;
  canArchive: boolean;
}

const AUTOSAVE_MS = 1200;

export function SkillEditor({ slug, initialContent, canPromote }: Props) {
  // We hold one source of truth: the YAML string. Form-mode edits round-trip
  // through parse → mutate → serialize. Body-mode edits replace the body
  // chunk. YAML-mode edits write directly. parseSkill is the only validator.
  const [yamlSource, setYamlSource] = useState(initialContent);
  const [mode, setMode] = useState<Mode>('form');
  const [showYamlMode, setShowYamlMode] = useState(false);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [savedMark, setSavedMark] = useState<string>('Saved');
  const [pendingSave, startSave] = useTransition();
  const router = useRouter();
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reparse on every change for the live validation gutter + form mode.
  const parsed = useMemo<SkillDoc | null>(() => {
    try {
      const doc = parseSkill(yamlSource);
      return doc;
    } catch (e) {
      // Don't toast — surface in the gutter.
      return null;
    }
  }, [yamlSource]);
  useEffect(() => {
    try {
      parseSkill(yamlSource);
      setParseErr(null);
    } catch (e) {
      setParseErr(e instanceof Error ? e.message : String(e));
    }
  }, [yamlSource]);

  // Autosave: PATCH after `AUTOSAVE_MS` of quiet. Bail if the content fails
  // to parse — we shouldn't persist invalid YAML.
  useEffect(() => {
    if (yamlSource === initialContent) return;
    if (parseErr) {
      setSavedMark('Unsaved · parse error');
      return;
    }
    setSavedMark('Saving…');
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/skills/${encodeURIComponent(slug)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: yamlSource }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { problem?: string };
          setSavedMark('Save failed');
          toast.error(body.problem ?? 'Autosave failed');
          return;
        }
        setSavedMark('Saved');
      } catch (e) {
        setSavedMark('Save failed');
        toast.error(e instanceof Error ? e.message : 'Autosave failed');
      }
    }, AUTOSAVE_MS);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [yamlSource, initialContent, parseErr, slug]);

  function rewriteFromDoc(doc: SkillDoc) {
    try {
      const next = serializeSkill(doc);
      setYamlSource(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to serialize');
    }
  }

  function promote() {
    startSave(async () => {
      const res = await fetch(`/api/skills/${encodeURIComponent(slug)}/promote`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { problem?: string };
        toast.error(body.problem ?? 'Promote failed');
        return;
      }
      toast.success('Promoted to active');
      router.push(`/skills/${slug}`);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex gap-1">
          <ModeButton current={mode} mode="form" setMode={setMode} label="Form" />
          <ModeButton current={mode} mode="body" setMode={setMode} label="Body" />
          {showYamlMode ? (
            <ModeButton current={mode} mode="yaml" setMode={setMode} label="YAML" />
          ) : null}
          <button
            type="button"
            onClick={() => setShowYamlMode((v) => !v)}
            className="ml-2 self-center text-[12px] text-text-subtle hover:text-accent"
            aria-label="Toggle YAML mode"
          >
            {showYamlMode ? 'Hide advanced' : 'Show advanced'}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-text-subtle">{savedMark}</span>
          {canPromote ? (
            <Button variant="primary" onClick={promote} disabled={pendingSave || !!parseErr}>
              Promote
            </Button>
          ) : null}
        </div>
      </div>

      {parseErr ? (
        <div className="rounded-md border border-error/40 bg-[color-mix(in_srgb,var(--error)_8%,transparent)] p-3 font-mono text-[12px] text-error">
          {parseErr}
        </div>
      ) : null}

      {mode === 'form' && parsed ? (
        <FormMode doc={parsed} onChange={rewriteFromDoc} />
      ) : null}
      {mode === 'form' && !parsed ? (
        <p className="text-[13px] text-text-subtle">
          Form mode disabled while YAML fails to parse. Fix the error above or
          switch to YAML mode.
        </p>
      ) : null}

      {mode === 'body' ? (
        <BodyMode yamlSource={yamlSource} onChange={setYamlSource} />
      ) : null}

      {mode === 'yaml' && showYamlMode ? (
        <YamlMode value={yamlSource} onChange={setYamlSource} />
      ) : null}
    </div>
  );
}

function ModeButton({
  current,
  mode,
  setMode,
  label,
}: {
  current: Mode;
  mode: Mode;
  setMode: (m: Mode) => void;
  label: string;
}) {
  const active = current === mode;
  return (
    <button
      type="button"
      onClick={() => setMode(mode)}
      className={
        'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ' +
        (active ? 'bg-surface-2 text-text' : 'text-text-muted hover:bg-surface-2 hover:text-text')
      }
    >
      {label}
    </button>
  );
}

function FormMode({ doc, onChange }: { doc: SkillDoc; onChange: (d: SkillDoc) => void }) {
  function update<K extends keyof SkillDoc['frontmatter']>(key: K, value: SkillDoc['frontmatter'][K]) {
    onChange({
      ...doc,
      frontmatter: { ...doc.frontmatter, [key]: value },
    });
  }
  function updateDefaults(next: SkillDefaults | undefined) {
    const fm = { ...doc.frontmatter };
    if (next === undefined) delete fm.defaults;
    else fm.defaults = next;
    onChange({ ...doc, frontmatter: fm });
  }
  const defaults = doc.frontmatter.defaults ?? {};

  return (
    <div className="space-y-6">
      <Field label="Name">
        <input
          type="text"
          value={doc.frontmatter.name}
          onChange={(e) => update('name', e.target.value)}
          className="form-input"
        />
      </Field>
      <Field label="Description">
        <textarea
          value={doc.frontmatter.description}
          onChange={(e) => update('description', e.target.value)}
          rows={2}
          className="form-input"
        />
      </Field>
      <Field label="When to use (optional)">
        <textarea
          value={doc.frontmatter.when_to_use ?? ''}
          onChange={(e) => update('when_to_use', e.target.value || undefined)}
          rows={2}
          className="form-input"
        />
      </Field>
      <Field label="Tools (comma-separated)">
        <input
          type="text"
          value={(doc.frontmatter.tools ?? []).join(', ')}
          onChange={(e) =>
            update(
              'tools',
              e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            )
          }
          className="form-input font-mono"
        />
      </Field>

      <fieldset className="space-y-3 rounded-md border border-border p-4">
        <legend className="caption px-1">Default filters</legend>
        <Field label="Providers (comma-separated)">
          <input
            type="text"
            value={(defaults.provider ?? []).join(', ')}
            onChange={(e) => {
              const arr = e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              updateDefaults({ ...defaults, provider: arr.length ? arr : undefined });
            }}
            className="form-input font-mono"
            placeholder="pylon, grain"
          />
        </Field>
        <Field label="Tier (comma-separated)">
          <input
            type="text"
            value={(defaults.accountFilter?.tier ?? []).join(', ')}
            onChange={(e) => {
              const arr = e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              const af = { ...(defaults.accountFilter ?? {}) };
              if (arr.length) af.tier = arr;
              else delete af.tier;
              updateDefaults({
                ...defaults,
                accountFilter: Object.keys(af).length ? af : undefined,
              });
            }}
            className="form-input font-mono"
            placeholder="T0, T1"
          />
        </Field>
        <Field label="Time window (e.g. 14d)">
          <input
            type="text"
            value={defaults.timeWindow && 'last' in defaults.timeWindow ? defaults.timeWindow.last : ''}
            onChange={(e) => {
              const v = e.target.value.trim();
              updateDefaults({
                ...defaults,
                timeWindow: v ? { last: v } : undefined,
              });
            }}
            className="form-input font-mono"
            placeholder="14d"
          />
        </Field>
      </fieldset>
    </div>
  );
}

function BodyMode({ yamlSource, onChange }: { yamlSource: string; onChange: (s: string) => void }) {
  // Slice the body out, edit it, splice it back. parseSkill drops the
  // frontmatter for us; we use a regex on the source to reconstruct.
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(yamlSource);
  const fm = m?.[1] ?? '';
  const body = m?.[2] ?? yamlSource;

  return (
    <Field label="Body (markdown)">
      <textarea
        value={body}
        onChange={(e) => {
          const next = `---\n${fm}\n---\n${e.target.value}`;
          onChange(next);
        }}
        rows={20}
        className="form-input font-mono text-[13px]"
      />
    </Field>
  );
}

function YamlMode({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <Field label="Raw YAML">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={28}
        spellCheck={false}
        className="form-input font-mono text-[13px]"
      />
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="caption text-text-subtle">{label}</span>
      {children}
    </label>
  );
}
