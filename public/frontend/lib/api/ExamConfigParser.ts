/**
 * CryptoExam Core — Exam Configuration Parser
 * 
 * This utility acts as the "AI pipeline" that parses exam metadata and returns
 * a structured configuration object used by the frontend to dynamically render
 * the exam session UI.
 * 
 * In production, this would be triggered when a setter uploads a paper (Mode 1),
 * edits one with AI (Mode 2), or generates one from PYQs/syllabus (Mode 3).
 * The pipeline extracts: total questions, sections, marking scheme, time limits,
 * question types, and returns a normalized ExamConfig.
 */

import { Exam, Question } from './types';

export interface SectionConfig {
  id: string;
  name: string;
  nameHi?: string;
  questionCount: number;
  positiveMarks: number;
  negativeMarks: number;
  /** Question indices (0-based) belonging to this section */
  questionIndices: number[];
}

export interface ExamRenderConfig {
  examId: string;
  examName: string;
  examNameHi?: string;
  examBody: string;
  totalQuestions: number;
  totalMarks: number;
  durationMinutes: number;
  durationFormatted: string;
  positiveMarks: number;
  negativeMarks: number;
  sections: SectionConfig[];
  setLabel: string;
  /** Number of distinct question sets */
  setsCount: number;
  /** Instructions text (HTML-safe) */
  instructions: string[];
}

/**
 * Parse an Exam object + its questions into a render-ready config.
 * This simulates what an AI pipeline would extract from uploaded papers.
 */
export function parseExamConfig(exam: Exam, questions: Question[]): ExamRenderConfig {
  // Group questions by subject → sections
  const subjectMap = new Map<string, number[]>();
  questions.forEach((q, idx) => {
    const existing = subjectMap.get(q.subject) || [];
    existing.push(idx);
    subjectMap.set(q.subject, existing);
  });

  const sections: SectionConfig[] = [];
  const taxonomySubjects = exam.subject_taxonomy.subjects;

  for (const [subjectName, indices] of subjectMap) {
    const taxonomyEntry = taxonomySubjects.find(s => s.name === subjectName);
    sections.push({
      id: subjectName.toLowerCase().replace(/\s+/g, '-'),
      name: subjectName,
      nameHi: taxonomyEntry?.name_hi,
      questionCount: indices.length,
      positiveMarks: exam.positive_marks,
      negativeMarks: exam.negative_marking,
      questionIndices: indices,
    });
  }

  // Format duration
  const hours = Math.floor(exam.duration_minutes / 60);
  const mins = exam.duration_minutes % 60;
  const durationFormatted = hours > 0
    ? `${hours} Hour${hours > 1 ? 's' : ''}${mins > 0 ? ` ${mins} Minutes` : ''}`
    : `${mins} Minutes`;

  // Generate standard instructions
  const instructions = generateInstructions(exam, sections);

  return {
    examId: exam.id,
    examName: exam.name,
    examNameHi: exam.name_hi,
    examBody: exam.exam_body,
    totalQuestions: questions.length,
    totalMarks: exam.total_marks,
    durationMinutes: exam.duration_minutes,
    durationFormatted,
    positiveMarks: exam.positive_marks,
    negativeMarks: exam.negative_marking,
    sections,
    setLabel: questions[0]?.set_label || 'A',
    setsCount: exam.sets_count,
    instructions,
  };
}

function generateInstructions(exam: Exam, sections: SectionConfig[]): string[] {
  const totalQ = sections.reduce((sum, s) => sum + s.questionCount, 0);
  return [
    `This examination contains ${totalQ} questions across ${sections.length} section(s): ${sections.map(s => s.name).join(', ')}.`,
    `Total duration: ${Math.floor(exam.duration_minutes / 60)} hour(s) ${exam.duration_minutes % 60} minute(s). The countdown timer at the top right shows the remaining time. When the timer reaches zero, the exam will be auto-submitted.`,
    `Marking Scheme: Each correct answer carries +${exam.positive_marks} marks. Each incorrect answer carries -${exam.negative_marking} mark(s). Unanswered questions carry 0 marks.`,
    `Total Marks: ${exam.total_marks}`,
    `The Question Palette on the right shows the status of each question using the following symbols:`,
    `◻ You have NOT visited the question yet.`,
    `🔴 You have NOT answered the question.`,
    `🟢 You have answered the question.`,
    `🟣 You have marked the question for review.`,
    `🟣🟢 You have answered AND marked for review — this will be considered for evaluation.`,
    `You can click on a question number in the palette to navigate directly to that question.`,
    `The "Mark for Review" status simply acts as a reminder. If you have selected an answer for a question that is "Marked for Review", the answer WILL be considered for evaluation.`,
    `You can click on "Save & Next" to save your answer and move to the next question.`,
    `You can click on "Clear Response" to deselect your answer.`,
    `You can click on "Mark for Review & Next" to mark the question for review and move on.`,
    `Navigate between sections using the section tabs at the top of the question palette.`,
    `This examination is conducted under strict anti-cheat protocols. Do not switch tabs, minimize the browser, use keyboard shortcuts, or attempt to access any other application during the exam. Violations are logged and may result in disqualification.`,
    `By proceeding, you confirm that you are the registered candidate and agree to all terms of the examination.`,
  ];
}
