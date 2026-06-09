/**
 * CryptoExam Core — Comprehensive Exam Catalog
 * 
 * Real exam structures for all supported Indian competitive examinations.
 * Each entry includes the authentic section breakdown, marking scheme,
 * duration, and question distribution as per official patterns.
 */

import { Exam } from './types';
import { mockUsers } from './mock-data';

const now = new Date();

/**
 * Comprehensive catalog of Indian competitive examinations
 * with their real-world structures and marking schemes.
 */
export const examCatalog: Exam[] = [
  // ═══════════════════════════════════════════════
  // 1. JEE MAIN (B.E./B.Tech Paper 1)
  // ═══════════════════════════════════════════════
  {
    id: 'exam-jee-main-2026',
    name: 'JEE Main 2026 — Session 2 (Paper 1: B.E./B.Tech)',
    name_hi: 'JEE मेन 2026 — सत्र 2 (पेपर 1: बी.ई./बी.टेक)',
    exam_body: 'NTA',
    subject_taxonomy: {
      subjects: [
        {
          name: 'Physics',
          name_hi: 'भौतिक विज्ञान',
          topics: ['Mechanics', 'Electrodynamics', 'Optics', 'Thermodynamics', 'Modern Physics', 'Waves & Oscillations'],
          question_count: 25, // 20 MCQ (Section A) + 5 Numerical (Section B)
        },
        {
          name: 'Chemistry',
          name_hi: 'रसायन विज्ञान',
          topics: ['Physical Chemistry', 'Organic Chemistry', 'Inorganic Chemistry'],
          question_count: 25,
        },
        {
          name: 'Mathematics',
          name_hi: 'गणित',
          topics: ['Calculus', 'Algebra', 'Coordinate Geometry', 'Trigonometry', 'Statistics & Probability', 'Vectors & 3D'],
          question_count: 25,
        },
      ],
    },
    exam_type: 'ONLINE_CBT',
    duration_minutes: 180, // 3 hours
    scheduled_at: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    status: 'LIVE',
    setter_id: mockUsers.setter.id,
    sets_count: 4,
    positive_marks: 4,
    negative_marking: 1,
    total_marks: 300, // 75 Qs × 4 marks
    instructions_text: 'Section A: 20 MCQs per subject (+4/-1). Section B: 5 Numerical Value per subject (+4/-1). All questions compulsory.',
    irt_config: { target_mean_b: 0.2, target_std_b: 1.1, min_a: 0.5, max_c: 0.25, tolerance: 0.15 },
    blooms_config: { targets: { '1': 10, '2': 20, '3': 30, '4': 25, '5': 10, '6': 5 } },
    question_hash: '0xjm01a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef12345678',
    candidate_count: 1200000,
    centers_count: 3200,
    created_at: '2026-02-15T09:00:00+05:30',
  },

  // ═══════════════════════════════════════════════
  // 2. JEE ADVANCED (Paper 1)
  // ═══════════════════════════════════════════════
  {
    id: 'exam-jee-advanced-2026-p1',
    name: 'JEE Advanced 2026 — Paper 1',
    name_hi: 'JEE एडवांस्ड 2026 — पेपर 1',
    exam_body: 'NTA', // Conducted by IITs
    subject_taxonomy: {
      subjects: [
        {
          name: 'Physics',
          name_hi: 'भौतिक विज्ञान',
          topics: ['Mechanics', 'Electromagnetism', 'Optics', 'Modern Physics', 'Thermodynamics'],
          question_count: 20,
        },
        {
          name: 'Chemistry',
          name_hi: 'रसायन विज्ञान',
          topics: ['Physical Chemistry', 'Organic Chemistry', 'Inorganic Chemistry'],
          question_count: 20,
        },
        {
          name: 'Mathematics',
          name_hi: 'गणित',
          topics: ['Calculus', 'Algebra', 'Geometry', 'Trigonometry', 'Combinatorics'],
          question_count: 20,
        },
      ],
    },
    exam_type: 'ONLINE_CBT',
    duration_minutes: 180,
    scheduled_at: new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString(),
    status: 'LOCKED',
    setter_id: mockUsers.setter.id,
    sets_count: 2,
    positive_marks: 3, // Varies by question type: +3/+4 for full, partial marking exists
    negative_marking: 1,
    total_marks: 180, // Paper 1: 180 marks
    instructions_text: 'MCQs (single/multiple correct), Numerical Answer Type, Matching Type. Partial marking for multi-correct MCQs. Paper 1 + Paper 2 = 360 total.',
    irt_config: { target_mean_b: 0.5, target_std_b: 1.3, min_a: 0.6, max_c: 0.2, tolerance: 0.1 },
    blooms_config: { targets: { '1': 5, '2': 15, '3': 25, '4': 30, '5': 15, '6': 10 } },
    question_hash: '0xja01b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0',
    candidate_count: 250000,
    centers_count: 600,
    created_at: '2026-04-01T09:00:00+05:30',
  },

  // ═══════════════════════════════════════════════
  // 3. NEET UG
  // ═══════════════════════════════════════════════
  {
    id: 'exam-neet-ug-2026',
    name: 'NEET UG 2026',
    name_hi: 'NEET UG 2026',
    exam_body: 'NTA',
    subject_taxonomy: {
      subjects: [
        { name: 'Physics', name_hi: 'भौतिक विज्ञान', topics: ['Mechanics', 'Optics', 'Electrodynamics', 'Thermodynamics', 'Modern Physics'], question_count: 45 },
        { name: 'Chemistry', name_hi: 'रसायन विज्ञान', topics: ['Organic', 'Inorganic', 'Physical Chemistry'], question_count: 45 },
        { name: 'Botany', name_hi: 'वनस्पति विज्ञान', topics: ['Plant Morphology', 'Cell Biology', 'Genetics', 'Ecology', 'Biotechnology'], question_count: 45 },
        { name: 'Zoology', name_hi: 'प्राणी विज्ञान', topics: ['Human Physiology', 'Animal Kingdom', 'Evolution', 'Reproduction'], question_count: 45 },
      ],
    },
    exam_type: 'ONLINE_CBT',
    duration_minutes: 200, // 3 hours 20 minutes
    scheduled_at: new Date(now.getTime() + 1 * 60 * 60 * 1000).toISOString(),
    status: 'LIVE',
    setter_id: mockUsers.setter.id,
    sets_count: 4,
    positive_marks: 4,
    negative_marking: 1,
    total_marks: 720, // 180 Qs × 4 marks
    instructions_text: '180 compulsory MCQs. All questions mandatory. +4 for correct, -1 for incorrect, 0 for unanswered.',
    irt_config: { target_mean_b: 0.0, target_std_b: 1.0, min_a: 0.5, max_c: 0.25, tolerance: 0.15 },
    blooms_config: { targets: { '1': 10, '2': 25, '3': 30, '4': 20, '5': 10, '6': 5 } },
    question_hash: '0xnt01a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef12345678',
    candidate_count: 2400000,
    centers_count: 4750,
    created_at: '2026-03-01T09:00:00+05:30',
  },

  // ═══════════════════════════════════════════════
  // 4. WBJEE
  // ═══════════════════════════════════════════════
  {
    id: 'exam-wbjee-2026',
    name: 'WBJEE 2026',
    name_hi: 'WBJEE 2026',
    exam_body: 'CUSTOM', // WBJEB
    subject_taxonomy: {
      subjects: [
        { name: 'Mathematics', topics: ['Algebra', 'Calculus', 'Coordinate Geometry', 'Trigonometry', 'Statistics'], question_count: 75 },
        { name: 'Physics', topics: ['Mechanics', 'Optics', 'Electrodynamics', 'Thermodynamics', 'Modern Physics'], question_count: 40 },
        { name: 'Chemistry', topics: ['Physical Chemistry', 'Organic Chemistry', 'Inorganic Chemistry'], question_count: 40 },
      ],
    },
    exam_type: 'ONLINE_CBT',
    duration_minutes: 240, // 4 hours (2h Paper 1 + 2h Paper 2)
    scheduled_at: new Date(now.getTime() + 96 * 60 * 60 * 1000).toISOString(),
    status: 'LOCKED',
    setter_id: mockUsers.setter.id,
    sets_count: 4,
    positive_marks: 2, // Category I: +1, Category II: +2, Category III: +2
    negative_marking: 0.25, // Cat I: -0.25, Cat II: -0.50, Cat III: no neg
    total_marks: 200,
    instructions_text: 'Paper 1: Mathematics (75Q, 100M, 2hrs). Paper 2: Physics+Chemistry (80Q, 100M, 2hrs). 3 categories with different marking.',
    irt_config: { target_mean_b: -0.1, target_std_b: 1.0, min_a: 0.4, max_c: 0.25, tolerance: 0.15 },
    blooms_config: { targets: { '1': 15, '2': 25, '3': 30, '4': 20, '5': 7, '6': 3 } },
    question_hash: '0xwb01a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef12345678',
    candidate_count: 120000,
    centers_count: 450,
    created_at: '2026-02-01T09:00:00+05:30',
  },

  // ═══════════════════════════════════════════════
  // 5. MHT-CET (PCM Group)
  // ═══════════════════════════════════════════════
  {
    id: 'exam-mht-cet-2026',
    name: 'MHT-CET 2026 — PCM Group',
    exam_body: 'CUSTOM', // Maharashtra CET Cell
    subject_taxonomy: {
      subjects: [
        { name: 'Physics', topics: ['Mechanics', 'Electrostatics', 'Magnetism', 'Optics', 'Semiconductor'], question_count: 50 },
        { name: 'Chemistry', topics: ['Physical', 'Organic', 'Inorganic', 'Analytical'], question_count: 50 },
        { name: 'Mathematics', topics: ['Calculus', 'Algebra', 'Trigonometry', 'Geometry', 'Statistics'], question_count: 50 },
      ],
    },
    exam_type: 'ONLINE_CBT',
    duration_minutes: 180, // 3 hours (90 min Section 1 + 90 min Section 2)
    scheduled_at: new Date(now.getTime() + 120 * 60 * 60 * 1000).toISOString(),
    status: 'LOCKED',
    setter_id: mockUsers.setter.id,
    sets_count: 4,
    positive_marks: 2, // Physics/Chem: 1 mark, Math: 2 marks
    negative_marking: 0, // No negative marking
    total_marks: 200,
    instructions_text: 'Section 1: Physics+Chemistry (50Qs, 1 mark each, 90 min). Section 2: Mathematics (50Qs, 2 marks each, 90 min). NO negative marking.',
    irt_config: { target_mean_b: 0.0, target_std_b: 1.0, min_a: 0.4, max_c: 0.25, tolerance: 0.15 },
    blooms_config: { targets: { '1': 15, '2': 30, '3': 30, '4': 15, '5': 7, '6': 3 } },
    question_hash: '0xmc01a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef12345678',
    candidate_count: 500000,
    centers_count: 800,
    created_at: '2026-03-15T09:00:00+05:30',
  },

  // ═══════════════════════════════════════════════
  // 6. SSC GD Constable
  // ═══════════════════════════════════════════════
  {
    id: 'exam-ssc-gd-2026',
    name: 'SSC GD Constable 2026',
    exam_body: 'SSC',
    subject_taxonomy: {
      subjects: [
        { name: 'General Intelligence & Reasoning', topics: ['Logical Reasoning', 'Analytical Ability', 'Pattern Recognition'], question_count: 20 },
        { name: 'General Knowledge & Awareness', topics: ['History', 'Geography', 'Polity', 'Current Affairs', 'Science'], question_count: 20 },
        { name: 'Elementary Mathematics', topics: ['Arithmetic', 'Algebra', 'Data Interpretation', 'Number System'], question_count: 20 },
        { name: 'English / Hindi', topics: ['Comprehension', 'Grammar', 'Vocabulary', 'Sentence Structure'], question_count: 20 },
      ],
    },
    exam_type: 'ONLINE_CBT',
    duration_minutes: 60, // 1 hour
    scheduled_at: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
    status: 'LOCKED',
    setter_id: mockUsers.setter.id,
    sets_count: 4,
    positive_marks: 2,
    negative_marking: 0.25,
    total_marks: 160, // 80 Qs × 2 marks
    instructions_text: '80 MCQs, 4 sections of 20 questions each. +2 per correct answer. -0.25 per incorrect answer. Duration: 60 minutes.',
    irt_config: { target_mean_b: -0.3, target_std_b: 0.8, min_a: 0.4, max_c: 0.25, tolerance: 0.15 },
    blooms_config: { targets: { '1': 20, '2': 35, '3': 25, '4': 15, '5': 5, '6': 0 } },
    question_hash: '0xgd01a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef12345678',
    candidate_count: 5000000,
    centers_count: 8500,
    created_at: '2026-01-15T09:00:00+05:30',
  },

  // ═══════════════════════════════════════════════
  // 7. SSC CGL Tier 1
  // ═══════════════════════════════════════════════
  {
    id: 'exam-ssc-cgl-2026',
    name: 'SSC CGL 2026 — Tier I',
    exam_body: 'SSC',
    subject_taxonomy: {
      subjects: [
        { name: 'General Intelligence & Reasoning', topics: ['Verbal Reasoning', 'Non-Verbal Reasoning', 'Analogy', 'Series'], question_count: 25 },
        { name: 'General Awareness', topics: ['History', 'Geography', 'Polity', 'Economics', 'Current Affairs', 'Science'], question_count: 25 },
        { name: 'Quantitative Aptitude', topics: ['Arithmetic', 'Algebra', 'Geometry', 'Mensuration', 'Data Interpretation'], question_count: 25 },
        { name: 'English Comprehension', topics: ['Reading Comprehension', 'Fill in the Blanks', 'Synonyms/Antonyms', 'Error Spotting', 'Cloze Test'], question_count: 25 },
      ],
    },
    exam_type: 'ONLINE_CBT',
    duration_minutes: 60,
    scheduled_at: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    status: 'COMPLETED',
    setter_id: mockUsers.setter.id,
    sets_count: 4,
    positive_marks: 2,
    negative_marking: 0.50,
    total_marks: 200, // 100 Qs × 2 marks
    instructions_text: '100 MCQs, 4 sections of 25 questions each. +2 per correct, -0.50 per incorrect. Qualifying stage for Tier II.',
    irt_config: { target_mean_b: -0.2, target_std_b: 0.9, min_a: 0.4, max_c: 0.25, tolerance: 0.15 },
    blooms_config: { targets: { '1': 15, '2': 30, '3': 30, '4': 15, '5': 7, '6': 3 } },
    question_hash: '0xcg01a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef12345678',
    candidate_count: 3200000,
    centers_count: 5800,
    created_at: '2026-01-10T09:00:00+05:30',
  },

  // ═══════════════════════════════════════════════
  // 8. SSC CHSL Tier 1
  // ═══════════════════════════════════════════════
  {
    id: 'exam-ssc-chsl-2026',
    name: 'SSC CHSL 2026 — Tier I',
    exam_body: 'SSC',
    subject_taxonomy: {
      subjects: [
        { name: 'General Intelligence', topics: ['Logical Reasoning', 'Analogies', 'Pattern Recognition', 'Coding-Decoding'], question_count: 25 },
        { name: 'General Awareness', topics: ['History', 'Geography', 'Polity', 'Science', 'Current Affairs'], question_count: 25 },
        { name: 'Quantitative Aptitude', topics: ['Arithmetic', 'Algebra', 'Geometry', 'Data Interpretation'], question_count: 25 },
        { name: 'English Language', topics: ['Comprehension', 'Grammar', 'Vocabulary', 'Sentence Correction'], question_count: 25 },
      ],
    },
    exam_type: 'ONLINE_CBT',
    duration_minutes: 60,
    scheduled_at: new Date(now.getTime() + 168 * 60 * 60 * 1000).toISOString(),
    status: 'LOCKED',
    setter_id: mockUsers.setter.id,
    sets_count: 4,
    positive_marks: 2,
    negative_marking: 0.50,
    total_marks: 200,
    instructions_text: '100 MCQs, 4 sections of 25 questions each. +2 per correct, -0.50 per incorrect. Qualifying for Tier II.',
    irt_config: { target_mean_b: -0.3, target_std_b: 0.9, min_a: 0.4, max_c: 0.25, tolerance: 0.15 },
    blooms_config: { targets: { '1': 20, '2': 30, '3': 25, '4': 15, '5': 7, '6': 3 } },
    question_hash: '0xch01a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef12345678',
    candidate_count: 2800000,
    centers_count: 5500,
    created_at: '2026-02-01T09:00:00+05:30',
  },

  // ═══════════════════════════════════════════════
  // 9. RRB NTPC CBT 1
  // ═══════════════════════════════════════════════
  {
    id: 'exam-rrb-ntpc-2026',
    name: 'RRB NTPC 2026 — CBT 1',
    exam_body: 'CUSTOM', // Railway Recruitment Board
    subject_taxonomy: {
      subjects: [
        { name: 'Mathematics', topics: ['Number System', 'Decimals & Fractions', 'Ratio & Proportion', 'Percentage', 'Simple & Compound Interest', 'Profit & Loss', 'Time & Work', 'Geometry', 'Mensuration'], question_count: 30 },
        { name: 'General Intelligence & Reasoning', topics: ['Analogies', 'Coding-Decoding', 'Syllogism', 'Venn Diagrams', 'Puzzles', 'Data Sufficiency'], question_count: 30 },
        { name: 'General Awareness', topics: ['Indian History', 'Geography', 'Indian Polity', 'Economics', 'General Science', 'Current Affairs'], question_count: 40 },
      ],
    },
    exam_type: 'ONLINE_CBT',
    duration_minutes: 90, // 1.5 hours
    scheduled_at: new Date(now.getTime() + 240 * 60 * 60 * 1000).toISOString(),
    status: 'LOCKED',
    setter_id: mockUsers.setter.id,
    sets_count: 4,
    positive_marks: 1,
    negative_marking: 0.33, // 1/3 mark deducted
    total_marks: 100,
    instructions_text: '100 MCQs across 3 sections. +1 per correct, -1/3 per incorrect. Duration: 90 minutes. CBT 1 is qualifying.',
    irt_config: { target_mean_b: -0.2, target_std_b: 0.8, min_a: 0.4, max_c: 0.25, tolerance: 0.15 },
    blooms_config: { targets: { '1': 20, '2': 35, '3': 25, '4': 15, '5': 5, '6': 0 } },
    question_hash: '0xrn01a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef12345678',
    candidate_count: 4500000,
    centers_count: 7500,
    created_at: '2026-01-20T09:00:00+05:30',
  },

  // ═══════════════════════════════════════════════
  // 10. ISI (Indian Statistical Institute) — B.Stat/B.Math Admission Test
  // ═══════════════════════════════════════════════
  {
    id: 'exam-isi-bstat-2026',
    name: 'ISI Admission Test 2026 — B.Stat / B.Math (UGA)',
    exam_body: 'CUSTOM', // ISI Kolkata
    subject_taxonomy: {
      subjects: [
        {
          name: 'Mathematics (MCQ — Part A)',
          topics: ['Algebra', 'Number Theory', 'Combinatorics', 'Geometry', 'Calculus', 'Probability'],
          question_count: 30, // Section A: 30 MCQs
        },
        {
          name: 'Mathematics (Subjective — Part B)',
          topics: ['Proofs', 'Real Analysis', 'Combinatorial Arguments', 'Inequalities', 'Functional Equations'],
          question_count: 8, // Section B: 8 subjective problems
        },
      ],
    },
    exam_type: 'ONLINE_CBT',
    duration_minutes: 240, // 4 hours (2h per section)
    scheduled_at: new Date(now.getTime() + 144 * 60 * 60 * 1000).toISOString(),
    status: 'LOCKED',
    setter_id: mockUsers.setter.id,
    sets_count: 1,
    positive_marks: 4, // Part A: +4 per correct MCQ
    negative_marking: 1, // Part A: -1 per incorrect MCQ. Part B: no negative
    total_marks: 100, // Part A: 30 marks, Part B: 70 marks (approx)
    instructions_text: 'Part A (MCQs): 30 questions, +4/-1 marking. Part B (Subjective): 8 problems, proof-based, no negative marking. Total: ~100 marks. Duration: 4 hours.',
    irt_config: { target_mean_b: 1.0, target_std_b: 1.5, min_a: 0.8, max_c: 0.15, tolerance: 0.1 },
    blooms_config: { targets: { '1': 0, '2': 5, '3': 15, '4': 30, '5': 30, '6': 20 } },
    question_hash: '0xis01a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef12345678',
    candidate_count: 15000,
    centers_count: 35,
    created_at: '2026-03-10T09:00:00+05:30',
  },

  // ═══════════════════════════════════════════════
  // 11. CMI (Chennai Mathematical Institute) — B.Sc Entrance
  // ═══════════════════════════════════════════════
  {
    id: 'exam-cmi-bsc-2026',
    name: 'CMI Entrance Exam 2026 — B.Sc (Mathematics & Computer Science)',
    exam_body: 'CUSTOM', // CMI Chennai
    subject_taxonomy: {
      subjects: [
        {
          name: 'Mathematics (Part A — Objective)',
          topics: ['Algebra', 'Geometry', 'Combinatorics', 'Number Theory', 'Calculus', 'Logical Reasoning'],
          question_count: 10, // Part A: ~10 objective problems
        },
        {
          name: 'Mathematics (Part B — Subjective)',
          topics: ['Proofs', 'Analysis', 'Algebra', 'Combinatorial Geometry', 'Functional Equations'],
          question_count: 6, // Part B: ~6 detailed proof problems
        },
      ],
    },
    exam_type: 'ONLINE_CBT',
    duration_minutes: 210, // 3.5 hours
    scheduled_at: new Date(now.getTime() + 192 * 60 * 60 * 1000).toISOString(),
    status: 'LOCKED',
    setter_id: mockUsers.setter.id,
    sets_count: 1,
    positive_marks: 4, // Varies; Part A ~4 marks per Q
    negative_marking: 0, // No negative marking
    total_marks: 120, // Part A: 40 marks, Part B: 80 marks
    instructions_text: 'Part A (Objective): ~10 questions, 40 marks. Part B (Subjective): ~6 proof-based problems, 80 marks. No negative marking. Duration: 3.5 hours.',
    irt_config: { target_mean_b: 1.2, target_std_b: 1.5, min_a: 0.9, max_c: 0.1, tolerance: 0.1 },
    blooms_config: { targets: { '1': 0, '2': 5, '3': 10, '4': 25, '5': 35, '6': 25 } },
    question_hash: '0xcm01a2b3c4d5e6f7890abcdef1234567890abcdef1234567890abcdef12345678',
    candidate_count: 8000,
    centers_count: 25,
    created_at: '2026-03-20T09:00:00+05:30',
  },
];

/** Get an exam by its ID */
export function getExamById(id: string): Exam | undefined {
  return examCatalog.find(e => e.id === id);
}

/** Get exams by category */
export function getExamsByCategory(category: 'engineering' | 'medical' | 'government' | 'premier'): Exam[] {
  switch (category) {
    case 'engineering':
      return examCatalog.filter(e => ['exam-jee-main-2026', 'exam-jee-advanced-2026-p1', 'exam-wbjee-2026', 'exam-mht-cet-2026'].includes(e.id));
    case 'medical':
      return examCatalog.filter(e => ['exam-neet-ug-2026'].includes(e.id));
    case 'government':
      return examCatalog.filter(e => ['exam-ssc-gd-2026', 'exam-ssc-cgl-2026', 'exam-ssc-chsl-2026', 'exam-rrb-ntpc-2026'].includes(e.id));
    case 'premier':
      return examCatalog.filter(e => ['exam-isi-bstat-2026', 'exam-cmi-bsc-2026'].includes(e.id));
    default:
      return examCatalog;
  }
}
