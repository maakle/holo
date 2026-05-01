'use client';

import { useState } from 'react';

export default function TeamPage() {
  const [email, setEmail] = useState('');
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setShareLink(null);
    setLoading(true);
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as {
        status?: string;
        inviteToken?: string;
        message?: string;
        problem?: string;
      };
      if (!res.ok) {
        setError(data.problem ?? 'Invite failed.');
      } else {
        setShareLink(`/accept-invite?token=${data.inviteToken}`);
        setEmail('');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        maxWidth: 560,
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      <div>
        <h1
          style={{
            fontFamily: 'var(--font-general-sans, "General Sans", sans-serif)',
            fontSize: 28,
            fontWeight: 600,
            lineHeight: '36px',
            letterSpacing: '-0.01em',
            color: 'var(--text, #FAFAF7)',
            margin: 0,
          }}
        >
          Team
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-geist, "Geist", sans-serif)',
            fontSize: 15,
            lineHeight: '24px',
            color: 'var(--text-muted, #A1A1AA)',
            margin: '4px 0 0',
          }}
        >
          Invite members to your organization.
        </p>
      </div>

      <form
        onSubmit={handleInvite}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          background: 'var(--surface, #141414)',
          border: '1px solid var(--border, #27272A)',
          borderRadius: 6,
          padding: 20,
        }}
      >
        <label
          htmlFor="invite-email"
          style={{
            fontFamily: 'var(--font-geist, "Geist", sans-serif)',
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--text-subtle, #71717A)',
          }}
        >
          Email address
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="invite-email"
            type="email"
            required
            placeholder="colleague@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              flex: 1,
              fontFamily: 'var(--font-geist, "Geist", sans-serif)',
              fontSize: 15,
              lineHeight: '24px',
              color: 'var(--text, #FAFAF7)',
              background: 'transparent',
              border: '1px solid var(--border, #27272A)',
              borderRadius: 4,
              padding: '8px 12px',
              outline: 'none',
            }}
            onFocus={(e) => {
              e.target.style.outline = '2px solid var(--accent, #3F47FF)';
              e.target.style.outlineOffset = '-1px';
            }}
            onBlur={(e) => {
              e.target.style.outline = 'none';
            }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              fontFamily: 'var(--font-geist, "Geist", sans-serif)',
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--accent-fg, #FFFFFF)',
              background: 'var(--accent, #3F47FF)',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              transition: 'opacity 100ms',
              whiteSpace: 'nowrap',
            }}
          >
            {loading ? 'Sending…' : 'Send invite'}
          </button>
        </div>

        {error && (
          <p
            style={{
              fontFamily: 'var(--font-geist, "Geist", sans-serif)',
              fontSize: 13,
              lineHeight: '20px',
              color: 'var(--error, #EF4444)',
              margin: 0,
            }}
          >
            {error}
          </p>
        )}
      </form>

      {shareLink && (
        <div
          style={{
            background: 'var(--surface, #141414)',
            border: '1px solid var(--border, #27272A)',
            borderRadius: 6,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <p
            style={{
              fontFamily: 'var(--font-geist, "Geist", sans-serif)',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-muted, #A1A1AA)',
              margin: 0,
            }}
          >
            Share this invite link
          </p>
          <code
            style={{
              display: 'block',
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 13,
              lineHeight: '20px',
              color: 'var(--text, #FAFAF7)',
              background: 'var(--code-bg, #0F0F11)',
              borderRadius: 4,
              padding: 12,
              wordBreak: 'break-all',
            }}
          >
            {typeof window !== 'undefined'
              ? `${window.location.origin}${shareLink}`
              : shareLink}
          </code>
          <p
            style={{
              fontFamily: 'var(--font-geist, "Geist", sans-serif)',
              fontSize: 12,
              lineHeight: '16px',
              color: 'var(--text-subtle, #71717A)',
              margin: 0,
            }}
          >
            Full invite email delivery ships in v0.2.
          </p>
        </div>
      )}
    </div>
  );
}
