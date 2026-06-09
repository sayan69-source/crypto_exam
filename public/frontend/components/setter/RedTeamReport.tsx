/**
 * CryptoExam Core — V3 §4.3 Red-Team Report panel.
 *
 * Renders the AI Adversarial Red-Team Agent's findings.
 *   • BLOCKERs in danger red — paper cannot lock until resolved.
 *   • WARNs in amber — may be acknowledged with a reason.
 *   • Each flag shows: question number, attack icon, persona, description, suggested fix.
 *
 * Drop into any setter page that has a `questions` array.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { redTeamApi, type RedTeamReport, type RedTeamFlag } from '@/lib/api/red-team';

const ATTACK_ICON: Record<string, string> = {
  AMBIGUITY: '❓', MULTIPLE_CORRECT: '✌️', NO_CORRECT: '🚫', ABSOLUTE_LANGUAGE: '🚦',
  CULTURAL_BIAS: '🌐', GRAMMAR_ELIM: '✏️', TRIVIAL_DISTRACTOR: '🪶', ANSWER_LEAKED: '🔓',
  SYLLABUS_BREACH: '📚', OUTDATED_FACT: '📜',
};
const PERSONA_LABEL: Record<string, string> = {
  clever_student: 'Clever Student', rti_officer: 'RTI Officer', opposition_lawyer: 'Opposition Lawyer',
};

export interface RedTeamReportPanelProps {
  questions: object[];
  answerKey?: Record<number, string>;
  examId?: string;
  autoRun?: boolean;
  onResult?: (report: RedTeamReport) => void;
}

export default function RedTeamReportPanel({ questions, answerKey, examId, autoRun = true, onResult }: RedTeamReportPanelProps) {
  const [report, setReport] = useState<RedTeamReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!questions.length) return;
    setBusy(true); setError(null);
    try {
      const r = await redTeamApi.run(questions, answerKey, examId);
      setReport(r); onResult?.(r);
    } catch (e) {
      setError((e as Error).message || 'Red-Team failed');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { if (autoRun) void run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const summary = useMemo(() => {
    if (!report) return null;
    if (report.blocker_count > 0) {
      return { tone: 'danger', text: `${report.blocker_count} Blocker${report.blocker_count === 1 ? '' : 's'} — fix all before locking`, lockable: false };
    }
    if (report.warning_count > 0) {
      return { tone: 'warn', text: `0 Blockers · ${report.warning_count} Warning${report.warning_count === 1 ? '' : 's'} — paper may be locked`, lockable: true };
    }
    return { tone: 'ok', text: 'Red-Team passed — 0 blockers, 0 warnings', lockable: true };
  }, [report]);

  return (
    <div style={{
      background: 'rgba(15, 23, 42, 0.6)',
      border: `1px solid ${summary?.tone === 'danger' ? '#dc2626' : summary?.tone === 'warn' ? '#d97706' : '#1A2D5A'}`,
      borderRadius: 14, padding: 22, marginTop: 18, fontFamily: 'var(--font-sans)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span style={{ fontSize: 22 }}>🛡️</span>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, color: '#fff', fontSize: 16 }}>AI Adversarial Red-Team Report</h3>
          <p style={{ margin: '2px 0 0', color: '#94a3b8', fontSize: 12 }}>
            Three personas attack every question: Clever Student · RTI Officer · Opposition Lawyer
          </p>
        </div>
        {report && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#64748b' }}>backend: {report.backend}</span>}
      </div>

      {busy && <div style={{ color: '#94a3b8', fontSize: 14 }}>Running adversarial attack on {questions.length} questions…</div>}
      {error && <div style={{ color: '#ef4444', fontSize: 14 }}>{error}</div>}

      {report && summary && (
        <>
          <div style={{
            padding: '12px 16px', borderRadius: 10, marginBottom: 14, fontWeight: 700, fontSize: 14,
            background: summary.tone === 'danger' ? 'rgba(220,38,38,0.15)' : summary.tone === 'warn' ? 'rgba(217,119,6,0.15)' : 'rgba(22,163,74,0.15)',
            color: summary.tone === 'danger' ? '#fca5a5' : summary.tone === 'warn' ? '#fbbf24' : '#86efac',
          }}>
            {summary.tone === 'danger' ? '🛑' : summary.tone === 'warn' ? '⚠️' : '✅'} {summary.text}
          </div>

          <FlagList flags={report.blockers} kind="BLOCKER" />
          <FlagList flags={report.warnings} kind="WARN" />

          <button onClick={run} disabled={busy} style={{
            marginTop: 6, background: 'transparent', color: '#94a3b8',
            border: '1px solid #1A2D5A', padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
          }}>↻ Re-run Red-Team</button>
        </>
      )}
    </div>
  );
}

function FlagList({ flags, kind }: { flags: RedTeamFlag[]; kind: 'BLOCKER' | 'WARN' }) {
  if (flags.length === 0) return null;
  const color = kind === 'BLOCKER' ? '#fca5a5' : '#fbbf24';
  return (
    <div style={{ marginBottom: 12 }}>
      <h4 style={{ margin: '8px 0', color, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{kind === 'BLOCKER' ? `${flags.length} Blocker(s)` : `${flags.length} Warning(s)`}</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {flags.map((f, i) => (
          <details key={`${kind}-${f.question_number}-${i}`} style={{
            border: `1px solid ${kind === 'BLOCKER' ? 'rgba(220,38,38,0.4)' : 'rgba(217,119,6,0.4)'}`,
            borderRadius: 8, padding: '8px 12px', background: 'rgba(8,14,30,0.6)',
          }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>{ATTACK_ICON[f.attack_type] ?? '⚑'}</span>
              <b style={{ color }}>Q{f.question_number}</b>
              <span style={{ color: '#cbd5e1' }}>· {f.attack_type.replace(/_/g, ' ')}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b' }}>{PERSONA_LABEL[f.persona] ?? f.persona} · {(f.confidence * 100).toFixed(0)}%</span>
            </summary>
            <p style={{ margin: '8px 0 4px', fontSize: 13, color: '#cbd5e1', lineHeight: 1.6 }}>{f.description}</p>
            {f.suggested_fix && (
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#86efac' }}>
                <b>Suggested fix:</b> {f.suggested_fix}
              </p>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}
