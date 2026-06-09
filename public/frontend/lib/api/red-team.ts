/**
 * CryptoExam Core — V3 §4.3 Red-Team API client.
 * POST /api/v1/question-modes/red-team with mock fallback.
 */

import { getAuthToken, USE_MOCK } from './client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export type RedTeamSeverity = 'BLOCKER' | 'WARN';
export type RedTeamAttackType =
  | 'AMBIGUITY' | 'MULTIPLE_CORRECT' | 'NO_CORRECT' | 'ABSOLUTE_LANGUAGE'
  | 'CULTURAL_BIAS' | 'GRAMMAR_ELIM' | 'TRIVIAL_DISTRACTOR' | 'ANSWER_LEAKED'
  | 'SYLLABUS_BREACH' | 'OUTDATED_FACT';

export interface RedTeamFlag {
  question_number: number;
  attack_type: RedTeamAttackType;
  severity: RedTeamSeverity;
  description: string;
  suggested_fix: string | null;
  confidence: number;
  persona: string;
}

export interface RedTeamReport {
  total_questions: number;
  blockers: RedTeamFlag[];
  warnings: RedTeamFlag[];
  passed_clean: number;
  red_team_passed: boolean;
  backend: string;
  blocker_count: number;
  warning_count: number;
}

function mockReport(questions: Array<Record<string, unknown>>): RedTeamReport {
  const blockers: RedTeamFlag[] = [];
  const warnings: RedTeamFlag[] = [];
  questions.forEach((q, i) => {
    const num = (q.question_number as number) ?? i + 1;
    const stem = ((q.question_text as string) || '').toLowerCase();
    const opts = ['A', 'B', 'C', 'D'].map((k) => ((q[`option_${k}`] as string) || '').trim().toLowerCase());
    // ABSOLUTE_LANGUAGE → WARN
    if (/always|never|all of the above|none of the above/.test(stem) ||
        opts.some((o) => /\b(always|never|only)\b/.test(o))) {
      warnings.push({ question_number: num, attack_type: 'ABSOLUTE_LANGUAGE', severity: 'WARN',
        description: "Absolute language ('always'/'never') invites legal challenge.",
        suggested_fix: 'Soften absolutes; specify context.', confidence: 0.85, persona: 'rti_officer' });
    }
    // MULTIPLE_CORRECT (duplicate options) → BLOCKER
    if (new Set(opts.filter(Boolean)).size < opts.filter(Boolean).length) {
      blockers.push({ question_number: num, attack_type: 'MULTIPLE_CORRECT', severity: 'BLOCKER',
        description: 'Two or more options are textually identical — multiple correct answers possible.',
        suggested_fix: 'Rewrite duplicate options as distinct misconception-based distractors.',
        confidence: 0.99, persona: 'opposition_lawyer' });
    }
    // OUTDATED_FACT → BLOCKER
    if (/pluto is a planet|9 planets|great wall.*visible from space/.test(stem)) {
      blockers.push({ question_number: num, attack_type: 'OUTDATED_FACT', severity: 'BLOCKER',
        description: 'Statement references a scientific fact that has been superseded.',
        suggested_fix: 'Update to current scientific consensus.',
        confidence: 0.9, persona: 'opposition_lawyer' });
    }
    // TRIVIAL_DISTRACTOR → WARN
    if (opts.some((o) => o.length > 0 && o.length <= 2)) {
      warnings.push({ question_number: num, attack_type: 'TRIVIAL_DISTRACTOR', severity: 'WARN',
        description: 'A distractor is one or two characters long — too short to test knowledge.',
        suggested_fix: 'Replace with a plausible alternative of comparable length.',
        confidence: 0.8, persona: 'clever_student' });
    }
  });
  const flagged = new Set([...blockers, ...warnings].map((f) => f.question_number));
  return {
    total_questions: questions.length, blockers, warnings,
    passed_clean: Math.max(0, questions.length - flagged.size),
    red_team_passed: blockers.length === 0, backend: 'mock',
    blocker_count: blockers.length, warning_count: warnings.length,
  };
}

export const redTeamApi = {
  async run(questions: object[], answer_key?: Record<number, string>, exam_id?: string): Promise<RedTeamReport> {
    if (!USE_MOCK) {
      try {
        const token = getAuthToken();
        const res = await fetch(`${API_BASE}/question-modes/red-team`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ questions, answer_key, exam_id }),
        });
        if (res.ok) return await res.json();
      } catch { /* fall through */ }
    }
    return new Promise((r) => setTimeout(() => r(mockReport(questions as any)), 800));
  },
};

export default redTeamApi;
