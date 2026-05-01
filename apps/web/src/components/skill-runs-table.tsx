'use client';

import { useState, Fragment } from 'react';

interface StepTrace {
  stepIndex: number;
  stepText: string;
  llmResponse: string;
}

interface SkillRun {
  id: string;
  skillName: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  steps: StepTrace[];
  errorMessage: string | null;
}

export function SkillRunsTable({ runs }: { runs: SkillRun[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (runs.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)', padding: '2rem 0' }}>
        No skill runs yet. Use the{' '}
        <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>execute_skill</code>{' '}
        MCP tool to run a skill.
      </p>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', textAlign: 'left' }}>
            <th style={{ padding: '8px 12px', fontWeight: 500 }}>Time</th>
            <th style={{ padding: '8px 12px', fontWeight: 500 }}>Skill</th>
            <th style={{ padding: '8px 12px', fontWeight: 500 }}>Status</th>
            <th style={{ padding: '8px 12px', fontWeight: 500 }}>Steps</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <Fragment key={run.id}>
              <tr
                onClick={() => setExpandedId(expandedId === run.id ? null : run.id)}
                style={{
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: expandedId === run.id ? 'var(--surface-2)' : undefined,
                }}
              >
                <td style={{ padding: '8px 12px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {new Date(run.startedAt).toISOString().replace('T', ' ').slice(0, 19)}
                </td>
                <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                  {run.skillName}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{
                    color: run.status === 'completed' ? 'var(--success)' : run.status === 'failed' ? 'var(--error)' : 'var(--text-muted)',
                    fontWeight: 500,
                  }}>
                    {run.status}
                  </span>
                </td>
                <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>{run.steps.length}</td>
              </tr>
              {expandedId === run.id && (
                <tr key={`${run.id}-detail`}>
                  <td colSpan={4} style={{ padding: '12px', background: 'var(--surface-2)' }}>
                    {run.errorMessage && (
                      <p style={{ color: 'var(--error)', fontSize: 13, marginBottom: 12 }}>
                        Error: {run.errorMessage}
                      </p>
                    )}
                    {run.steps.map((step) => (
                      <div key={step.stepIndex} style={{ marginBottom: 12 }}>
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 4 }}>
                          Step {step.stepIndex + 1}
                        </p>
                        <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 6 }}>{step.stepText}</p>
                        <pre style={{ fontSize: 12, fontFamily: 'var(--font-mono)', background: 'var(--code-bg)', padding: 10, borderRadius: 4, margin: 0, color: 'var(--text)', overflowX: 'auto' }}>
                          {step.llmResponse}
                        </pre>
                      </div>
                    ))}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
