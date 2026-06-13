/**
 * CryptoExam Core — Mock Data Provider
 * Realistic Indian exam data for demo-ready UI without backend
 */

import type {
  User, Exam, Question, Center, HardwareNode, Session,
  Anomaly, BlockchainEvent, CryptoReceipt, DashboardMetrics,
  LiveExamSummary, IntegrityReport, AnswerSummaryItem,
  TrustedInstitution, SetterMetadata, PYQUpload, SyllabusConfig,
} from './types';

// ── Users ──

export const mockUsers: Record<string, User> = {
  candidate: {
    id: 'c1a2b3c4-d5e6-7890-abcd-ef1234567890',
    email: 'priya.sharma@gmail.com',
    phone: '+919876543210',
    role: 'CANDIDATE',
    full_name: 'Priya Sharma',
    name_hi: 'प्रिया शर्मा',
    locale: 'en',
    institution: 'Delhi Public School, Patna',
    state: 'Bihar',
    district: 'Patna',
    dpdp_consent: true,
    is_active: true,
    created_at: '2026-01-15T10:00:00+05:30',
  },
  setter: {
    id: 's1a2b3c4-d5e6-7890-abcd-ef1234567890',
    email: 'dr.raghav.iyer@nta.gov.in',
    role: 'SETTER',
    full_name: 'Dr. Raghav Iyer',
    name_hi: 'डॉ. राघव अय्यर',
    locale: 'en',
    institution: 'National Testing Agency',
    state: 'Delhi (NCT)',
    dpdp_consent: true,
    is_active: true,
    created_at: '2025-08-01T09:00:00+05:30',
  },
  admin: {
    id: 'a1a2b3c4-d5e6-7890-abcd-ef1234567890',
    email: 'admin@cryptoexam.in',
    role: 'ADMIN',
    full_name: 'Vikram Singh Rathore',
    name_hi: 'विक्रम सिंह राठौर',
    locale: 'en',
    institution: 'CryptoExam Core',
    state: 'Delhi (NCT)',
    dpdp_consent: true,
    is_active: true,
    created_at: '2025-06-01T09:00:00+05:30',
  },
};

// ── Exams ──

const now = new Date();
const examTime = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now

export const mockExams: Exam[] = [
  {
    id: 'e1a2b3c4-5678-90ab-cdef-1234567890ab',
    name: 'NEET UG 2026 — Phase I',
    name_hi: 'NEET UG 2026 — चरण I',
    exam_body: 'NTA',
    subject_taxonomy: {
      subjects: [
        { name: 'Physics', name_hi: 'भौतिक विज्ञान', topics: ['Mechanics', 'Optics', 'Electrodynamics', 'Thermodynamics', 'Modern Physics'], question_count: 45 },
        { name: 'Chemistry', name_hi: 'रसायन विज्ञान', topics: ['Organic', 'Inorganic', 'Physical Chemistry'], question_count: 45 },
        { name: 'Biology', name_hi: 'जीव विज्ञान', topics: ['Botany', 'Zoology', 'Human Physiology', 'Genetics', 'Ecology'], question_count: 90 },
      ],
    },
    exam_type: 'ONLINE_CBT',
    duration_minutes: 200,
    scheduled_at: examTime.toISOString(),
    status: 'LIVE',
    setter_id: mockUsers.setter.id,
    sets_count: 4,
    positive_marks: 4,
    negative_marking: 1,
    total_marks: 720,
    irt_config: { target_mean_b: 0.0, target_std_b: 1.0, min_a: 0.5, max_c: 0.25, tolerance: 0.15 },
    blooms_config: { targets: { '1': 10, '2': 25, '3': 30, '4': 20, '5': 10, '6': 5 } },
    question_hash: '0xa3f8c2e1d4b5a6978c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2',
    zk_proof_hash: '0x1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
    zk_proof_ipfs: 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco',
    drand_round: 4823901,
    polygon_exam_tx: '0x7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8',
    polygon_zkproof_tx: '0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3',
    answer_merkle_root: '0xf1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4',
    polygon_answer_tx: '0x4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5',
    candidate_count: 2400000,
    centers_count: 4750,
    created_at: '2026-03-01T09:00:00+05:30',
  },
  {
    id: 'e2b3c4d5-6789-01bc-def0-234567890bcd',
    name: 'JEE Main 2026 — Session 2',
    exam_body: 'NTA',
    subject_taxonomy: {
      subjects: [
        { name: 'Physics', topics: ['Mechanics', 'Waves', 'Electrostatics'], question_count: 30 },
        { name: 'Chemistry', topics: ['Organic', 'Inorganic', 'Physical'], question_count: 30 },
        { name: 'Mathematics', topics: ['Calculus', 'Algebra', 'Coordinate Geometry'], question_count: 30 },
      ],
    },
    exam_type: 'ONLINE_CBT',
    duration_minutes: 180,
    scheduled_at: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
    status: 'LOCKED',
    setter_id: mockUsers.setter.id,
    sets_count: 4,
    positive_marks: 4,
    negative_marking: 1,
    total_marks: 300,
    irt_config: { target_mean_b: 0.2, target_std_b: 1.1, min_a: 0.5, max_c: 0.25, tolerance: 0.15 },
    blooms_config: { targets: { '1': 10, '2': 20, '3': 30, '4': 25, '5': 10, '6': 5 } },
    question_hash: '0xb4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4',
    zk_proof_hash: '0xc5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5',
    polygon_exam_tx: '0x8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9',
    polygon_zkproof_tx: '0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4',
    candidate_count: 1200000,
    centers_count: 3200,
    created_at: '2026-02-15T09:00:00+05:30',
  },
  {
    id: 'e3c4d5e6-7890-12cd-ef01-345678901cde',
    name: 'SSC CGL 2026 — Tier I',
    exam_body: 'SSC',
    subject_taxonomy: {
      subjects: [
        { name: 'Reasoning', topics: ['Logical', 'Analytical', 'Verbal'], question_count: 25 },
        { name: 'Quantitative Aptitude', topics: ['Arithmetic', 'Algebra', 'Data Interpretation'], question_count: 25 },
        { name: 'English', topics: ['Comprehension', 'Grammar', 'Vocabulary'], question_count: 25 },
        { name: 'General Knowledge', topics: ['History', 'Geography', 'Science', 'Current Affairs'], question_count: 25 },
      ],
    },
    exam_type: 'ONLINE_CBT',
    duration_minutes: 60,
    scheduled_at: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    status: 'COMPLETED',
    setter_id: mockUsers.setter.id,
    sets_count: 4,
    positive_marks: 2,
    negative_marking: 0.5,
    total_marks: 200,
    irt_config: { target_mean_b: -0.2, target_std_b: 0.9, min_a: 0.4, max_c: 0.25, tolerance: 0.15 },
    blooms_config: { targets: { '1': 15, '2': 30, '3': 30, '4': 15, '5': 7, '6': 3 } },
    answer_merkle_root: '0xe2d3c4b5a6978879605a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3',
    polygon_answer_tx: '0x5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6',
    candidate_count: 3200000,
    centers_count: 5800,
    created_at: '2026-01-10T09:00:00+05:30',
  },
];

// ── Questions (NEET mock — 5 sample) ──

export const mockQuestions: Question[] = [
  {
    id: 'q001', exam_id: mockExams[0].id, set_label: 'B', sequence_number: 1,
    text: 'A body of mass 5 kg is thrown vertically upward with a velocity of 20 m/s. The kinetic energy of the body at the highest point is:',
    text_hi: '5 kg द्रव्यमान का एक पिंड 20 m/s के वेग से ऊर्ध्वाधर ऊपर की ओर फेंका जाता है। उच्चतम बिंदु पर पिंड की गतिज ऊर्जा है:',
    options: { A: '0 J', B: '500 J', C: '1000 J', D: '250 J' },
    correct_option: 'A', subject: 'Physics', topic: 'Mechanics',
    blooms_level: 2, irt_b: -0.5, irt_a: 1.2, irt_c: 0.2, source: 'AI_GENERATED', is_accepted: true,
  },
  {
    id: 'q002', exam_id: mockExams[0].id, set_label: 'B', sequence_number: 2,
    text: 'Which of the following molecules has the highest dipole moment?',
    text_hi: 'निम्नलिखित में से किस अणु का द्विध्रुव आघूर्ण सबसे अधिक है?',
    options: { A: 'CO₂', B: 'H₂O', C: 'NF₃', D: 'NH₃' },
    correct_option: 'D', subject: 'Chemistry', topic: 'Physical Chemistry',
    blooms_level: 3, irt_b: 0.3, irt_a: 1.5, irt_c: 0.18, source: 'AI_GENERATED', is_accepted: true,
  },
  {
    id: 'q003', exam_id: mockExams[0].id, set_label: 'B', sequence_number: 3,
    text: 'The process of formation of mRNA from DNA is called:',
    text_hi: 'DNA से mRNA बनने की प्रक्रिया को कहते हैं:',
    options: { A: 'Translation', B: 'Transcription', C: 'Replication', D: 'Transduction' },
    correct_option: 'B', subject: 'Biology', topic: 'Genetics',
    blooms_level: 1, irt_b: -1.2, irt_a: 0.8, irt_c: 0.25, source: 'AI_GENERATED', is_accepted: true,
  },
  {
    id: 'q004', exam_id: mockExams[0].id, set_label: 'B', sequence_number: 4,
    text: 'A concave mirror of focal length 15 cm forms an image at a distance of 30 cm from the mirror. The object distance is:',
    options: { A: '30 cm', B: '20 cm', C: '10 cm', D: '45 cm' },
    correct_option: 'A', subject: 'Physics', topic: 'Optics',
    blooms_level: 3, irt_b: 0.1, irt_a: 1.3, irt_c: 0.22, source: 'AI_GENERATED', is_accepted: true,
  },
  {
    id: 'q005', exam_id: mockExams[0].id, set_label: 'B', sequence_number: 5,
    text: 'Which enzyme is responsible for unwinding the DNA double helix during replication?',
    text_hi: 'प्रतिकृति के दौरान DNA द्विकुंडल को खोलने के लिए कौन सा एंजाइम उत्तरदायी है?',
    options: { A: 'DNA Polymerase', B: 'Helicase', C: 'Ligase', D: 'Primase' },
    correct_option: 'B', subject: 'Biology', topic: 'Genetics',
    blooms_level: 2, irt_b: -0.8, irt_a: 1.0, irt_c: 0.20, source: 'AI_GENERATED', is_accepted: true,
  },
];

// Generate 25 more questions to fill a realistic section
for (let i = 6; i <= 30; i++) {
  const subjects = ['Physics', 'Chemistry', 'Biology', 'Biology'];
  const subj = subjects[i % 4];
  mockQuestions.push({
    id: `q${String(i).padStart(3, '0')}`,
    exam_id: mockExams[0].id,
    set_label: 'B',
    sequence_number: i,
    text: `Sample ${subj} question #${i} — This is a placeholder question for the exam interface demo.`,
    options: { A: `Option A for Q${i}`, B: `Option B for Q${i}`, C: `Option C for Q${i}`, D: `Option D for Q${i}` },
    correct_option: ['A', 'B', 'C', 'D'][i % 4],
    subject: subj,
    topic: subj === 'Physics' ? 'Mechanics' : subj === 'Chemistry' ? 'Organic' : 'Zoology',
    blooms_level: ((i % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6,
    irt_b: Math.round((Math.random() * 4 - 2) * 100) / 100,
    irt_a: Math.round((0.5 + Math.random() * 2) * 100) / 100,
    irt_c: Math.round((Math.random() * 0.25) * 100) / 100,
    source: 'AI_GENERATED',
    is_accepted: true,
  });
}

// ── Centers (India-wide) ──

export const mockCenters: Center[] = [
  { id: 'ctr-001', name: 'Delhi Public School Dwarka', state: 'Delhi (NCT)', district: 'South West Delhi', city: 'New Delhi', address: 'Sector 12, Dwarka', pincode: '110078', latitude: 28.5921, longitude: 77.0460, capacity: 500, invigilator_name: 'Dr. Anita Desai', invigilator_phone: '+911234567890', connectivity: 'TIER_1_METRO', isp: 'Jio Fiber', status: 'healthy', candidates_present: 487, candidates_total: 500 },
  { id: 'ctr-002', name: 'IIT Bombay Convocation Hall', state: 'Maharashtra', district: 'Mumbai', city: 'Mumbai', address: 'Powai, Mumbai', pincode: '400076', latitude: 19.1334, longitude: 72.9133, capacity: 800, invigilator_name: 'Prof. Suresh Nair', invigilator_phone: '+919876543210', connectivity: 'TIER_1_METRO', isp: 'Airtel Fiber', status: 'healthy', candidates_present: 792, candidates_total: 800 },
  { id: 'ctr-003', name: 'Patna Science College', state: 'Bihar', district: 'Patna', city: 'Patna', address: 'Ashok Rajpath, Patna', pincode: '800005', latitude: 25.6189, longitude: 85.1376, capacity: 300, invigilator_name: 'Shri Rajesh Kumar', invigilator_phone: '+919123456789', connectivity: 'TIER_2_4G', isp: 'Airtel 4G', status: 'degraded', candidates_present: 294, candidates_total: 300 },
  { id: 'ctr-004', name: 'Kendriya Vidyalaya Tezpur', state: 'Assam', district: 'Sonitpur', city: 'Tezpur', address: 'Dekargaon, Tezpur', pincode: '784028', latitude: 26.6338, longitude: 92.8006, capacity: 150, invigilator_name: 'Smt. Lakshmi Bora', invigilator_phone: '+919988776655', connectivity: 'TIER_3_BSNL', isp: 'BSNL', status: 'healthy', candidates_present: 148, candidates_total: 150 },
  { id: 'ctr-006', name: 'SRM University Chennai', state: 'Tamil Nadu', district: 'Kancheepuram', city: 'Chennai', address: 'Kattankulathur', pincode: '603203', latitude: 12.8231, longitude: 80.0444, capacity: 600, invigilator_name: 'Dr. K. Ramasamy', invigilator_phone: '+919445566778', connectivity: 'TIER_1_METRO', isp: 'Jio Fiber', status: 'healthy', candidates_present: 589, candidates_total: 600 },
  { id: 'ctr-007', name: 'IIIT Hyderabad', state: 'Telangana', district: 'Hyderabad', city: 'Hyderabad', address: 'Gachibowli', pincode: '500032', latitude: 17.4459, longitude: 78.3497, capacity: 400, invigilator_name: 'Dr. Priya Reddy', invigilator_phone: '+919556677889', connectivity: 'TIER_1_METRO', isp: 'ACT Fibernet', status: 'healthy', candidates_present: 398, candidates_total: 400 },
  { id: 'ctr-008', name: 'Jadavpur University', state: 'West Bengal', district: 'Kolkata', city: 'Kolkata', address: 'Raja S.C. Mullick Road', pincode: '700032', latitude: 22.4966, longitude: 88.3713, capacity: 350, invigilator_name: 'Prof. Arijit Banerjee', invigilator_phone: '+919667788990', connectivity: 'TIER_1_METRO', isp: 'Airtel Fiber', status: 'incident', candidates_present: 201, candidates_total: 350 },
];

// ── Hardware Nodes ──

export const mockNodes: HardwareNode[] = mockCenters.map((c, i) => ({
  id: `node-${String(i + 1).padStart(3, '0')}`,
  center_id: c.id,
  center_name: c.name,
  serial_number: `CEX-2026-${String(1000 + i)}`,
  status: c.status === 'incident' ? 'ERROR' as const : 'COMPLETE' as const,
  tpm_ok: true,
  gps_ok: true,
  atecc_ok: true,
  tamper_mesh_ok: c.status !== 'incident',
  firmware_version: 'v2.1.3',
  last_heartbeat: new Date(now.getTime() - Math.random() * 60000).toISOString(),
  battery_percent: 100,
}));

// ── Anomalies ──

export const mockAnomalies: Anomaly[] = [
  { id: 'an-001', exam_id: mockExams[0].id, center_id: 'ctr-008', center_name: 'Jadavpur University', candidate_name: 'A. Ghosh (JU-****2847)', type: 'TAB_SWITCH', severity: 2, details: { count: 3 }, resolved: false, created_at: new Date(now.getTime() - 300000).toISOString() },
  { id: 'an-002', exam_id: mockExams[0].id, center_id: 'ctr-003', center_name: 'Patna Science College', candidate_name: 'R. Yadav (PS-****1392)', type: 'FULLSCREEN_EXIT', severity: 3, details: { count: 5 }, resolved: false, created_at: new Date(now.getTime() - 240000).toISOString() },
  { id: 'an-003', exam_id: mockExams[0].id, center_id: 'ctr-008', center_name: 'Jadavpur University', type: 'NETWORK_DROP', severity: 4, details: { duration_sec: 45, affected_candidates: 149 }, resolved: false, created_at: new Date(now.getTime() - 120000).toISOString() },
  { id: 'an-004', exam_id: mockExams[0].id, center_id: 'ctr-002', center_name: 'IIT Bombay', candidate_name: 'S. Patil (IB-****4521)', type: 'FACE_FAIL', severity: 3, details: { confidence: 0.62 }, resolved: true, created_at: new Date(now.getTime() - 600000).toISOString() },
  { id: 'an-005', exam_id: mockExams[0].id, center_id: 'ctr-001', center_name: 'DPS Dwarka', candidate_name: 'M. Kapoor (DP-****7834)', type: 'COPY_ATTEMPT', severity: 2, details: { text_length: 0 }, resolved: false, created_at: new Date(now.getTime() - 180000).toISOString() },
];

// ── Blockchain Events ──

export const mockBlockchainEvents: BlockchainEvent[] = [
  { type: 'ExamCreated', tx_hash: '0x7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8', block_number: 58234912, timestamp: '2026-06-01T09:00:00+05:30', exam_id: mockExams[0].id, status: 'confirmed', decoded_data: { examId: mockExams[0].id, setter: '0x...Iyer' } },
  { type: 'ZKProofSubmitted', tx_hash: '0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3', block_number: 58234950, timestamp: '2026-06-05T14:30:00+05:30', exam_id: mockExams[0].id, status: 'confirmed', decoded_data: { proofHash: mockExams[0].zk_proof_hash, questionHash: mockExams[0].question_hash } },
  { type: 'PaperLocked', tx_hash: '0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4', block_number: 58234985, timestamp: '2026-06-05T15:00:00+05:30', exam_id: mockExams[0].id, status: 'confirmed' },
  { type: 'ExamStarted', tx_hash: '0x4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5', block_number: 58240100, timestamp: examTime.toISOString(), exam_id: mockExams[0].id, status: 'confirmed' },
  { type: 'ProofOfDelivery', tx_hash: '0x5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6', block_number: 58240102, timestamp: new Date(examTime.getTime() + 30000).toISOString(), exam_id: mockExams[0].id, status: 'confirmed', decoded_data: { nodeCount: 7, candidateCount: 2967 } },
];

// ── Dashboard Metrics ──

export const mockDashboard: DashboardMetrics = {
  candidates_online: 2967,
  centers_healthy: 6,
  centers_total: 7,
  blockchain_tps: 12,
  active_anomalies: 4,
  live_exams: [
    {
      id: mockExams[0].id,
      name: 'NEET UG 2026 — Phase I',
      time_remaining_seconds: 7200,
      candidates_online: 2967,
      candidates_total: 3210,
      centers_healthy: 6,
      centers_total: 7,
      anomaly_count: 4,
      status: 'LIVE',
      health: 'degraded',
    },
  ],
};

// ── Crypto Receipt ──

export const mockReceipt: CryptoReceipt = {
  candidate_name: 'Priya Sharma',
  roll_number: 'NEET-2026-BIH-0847291',
  exam_name: 'NEET UG 2026 — Phase I',
  exam_body: 'NTA',
  exam_date: '07 Jun 2026',
  entered_at: '09:30:00 IST',
  submitted_at: '12:45:23 IST',
  duration_elapsed: '3h 15m 23s',
  answer_merkle_root: '0xf1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4',
  polygon_answer_tx: '0x4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5',
  block_number: 58241500,
  block_timestamp: '2026-06-07T12:45:30+05:30',
  zk_proof_verified: true,
  zk_proof_tx: '0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3',
  merkle_leaf: '0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
  merkle_proof_path: [
    '0x1111111111111111111111111111111111111111111111111111111111111111',
    '0x2222222222222222222222222222222222222222222222222222222222222222',
    '0x3333333333333333333333333333333333333333333333333333333333333333',
    '0x4444444444444444444444444444444444444444444444444444444444444444',
  ],
  answers_summary: Array.from({ length: 30 }, (_, i): AnswerSummaryItem => ({
    question_number: i + 1,
    section: i < 10 ? 'Physics' : i < 20 ? 'Chemistry' : 'Biology',
    status: i === 7 || i === 22 ? 'flagged_answered' : i === 14 || i === 28 ? 'skipped' : 'answered',
    time_spent_seconds: Math.floor(60 + Math.random() * 300),
  })),
};

// ── Integrity Report ──

export const mockIntegrityReport: IntegrityReport = {
  exam_id: mockExams[0].id,
  question_hash_matches: true,
  zk_proof_valid: true,
  paper_locked_before_t0: true,
  answer_merkle_committed: true,
  proof_of_delivery: true,
  overall_verdict: 'INTEGRITY_VERIFIED',
  details: [
    { label: 'Question hash matches on-chain commitment', passed: true, timestamp: '2026-06-05T15:00:00+05:30', tx_hash: '0x3c4d...b3c4' },
    { label: 'ZK Difficulty Proof on-chain and valid', passed: true, timestamp: '2026-06-05T14:30:00+05:30', tx_hash: '0x2b3c...a2b3' },
    { label: 'Paper locked ≥72h before scheduled T₀', passed: true, timestamp: '2026-06-05T15:00:00+05:30', detail: 'Locked 47h before T₀' },
    { label: 'Answer Merkle Root committed', passed: true, timestamp: '2026-06-07T12:45:30+05:30', tx_hash: '0x4d5e...c4d5' },
    { label: 'ProofOfDelivery submitted by hardware nodes', passed: true, timestamp: '2026-06-07T09:47:30+05:30', tx_hash: '0x5e6f...d5e6', detail: '8 nodes, 2967 sessions' },
    { label: 'No emergency events (pause/abort) recorded', passed: true },
  ],
};

// ── Trusted Institutions (Paper Mode 1) ──

export const mockTrustedInstitutions: TrustedInstitution[] = [
  { id: 'iit-bom', name: 'Indian Institute of Technology Bombay', short_name: 'IIT Bombay', tier: 'PREMIER_VERIFIED', location: 'Mumbai, Maharashtra', established_year: 1958, exams_conducted: 342, leak_incidents: 0, verified: true, verification_date: '2025-11-15T10:00:00+05:30' },
  { id: 'iit-del', name: 'Indian Institute of Technology Delhi', short_name: 'IIT Delhi', tier: 'PREMIER_VERIFIED', location: 'New Delhi, Delhi', established_year: 1961, exams_conducted: 318, leak_incidents: 0, verified: true, verification_date: '2025-11-15T10:00:00+05:30' },
  { id: 'iit-mad', name: 'Indian Institute of Technology Madras', short_name: 'IIT Madras', tier: 'PREMIER_VERIFIED', location: 'Chennai, Tamil Nadu', established_year: 1959, exams_conducted: 356, leak_incidents: 0, verified: true, verification_date: '2025-11-15T10:00:00+05:30' },
  { id: 'iit-kan', name: 'Indian Institute of Technology Kanpur', short_name: 'IIT Kanpur', tier: 'PREMIER_VERIFIED', location: 'Kanpur, Uttar Pradesh', established_year: 1959, exams_conducted: 289, leak_incidents: 0, verified: true, verification_date: '2025-11-15T10:00:00+05:30' },
  { id: 'iit-kgp', name: 'Indian Institute of Technology Kharagpur', short_name: 'IIT Kharagpur', tier: 'PREMIER_VERIFIED', location: 'Kharagpur, West Bengal', established_year: 1951, exams_conducted: 412, leak_incidents: 0, verified: true, verification_date: '2025-11-15T10:00:00+05:30' },
  { id: 'iit-rke', name: 'Indian Institute of Technology Roorkee', short_name: 'IIT Roorkee', tier: 'PREMIER_VERIFIED', location: 'Roorkee, Uttarakhand', established_year: 1847, exams_conducted: 502, leak_incidents: 0, verified: true, verification_date: '2025-11-15T10:00:00+05:30' },
  { id: 'iit-ghy', name: 'Indian Institute of Technology Guwahati', short_name: 'IIT Guwahati', tier: 'PREMIER_VERIFIED', location: 'Guwahati, Assam', established_year: 1994, exams_conducted: 178, leak_incidents: 0, verified: true, verification_date: '2025-11-15T10:00:00+05:30' },
  { id: 'iisc-blr', name: 'Indian Institute of Science', short_name: 'IISc Bangalore', tier: 'PREMIER_VERIFIED', location: 'Bangalore, Karnataka', established_year: 1909, exams_conducted: 267, leak_incidents: 0, verified: true, verification_date: '2025-11-15T10:00:00+05:30' },
  { id: 'isi-kol', name: 'Indian Statistical Institute', short_name: 'ISI Kolkata', tier: 'PREMIER_VERIFIED', location: 'Kolkata, West Bengal', established_year: 1931, exams_conducted: 198, leak_incidents: 0, verified: true, verification_date: '2025-11-15T10:00:00+05:30' },
  { id: 'cmi-che', name: 'Chennai Mathematical Institute', short_name: 'CMI Chennai', tier: 'PREMIER_VERIFIED', location: 'Chennai, Tamil Nadu', established_year: 1989, exams_conducted: 124, leak_incidents: 0, verified: true, verification_date: '2025-11-15T10:00:00+05:30' },
  { id: 'tifr-mum', name: 'Tata Institute of Fundamental Research', short_name: 'TIFR', tier: 'PREMIER_VERIFIED', location: 'Mumbai, Maharashtra', established_year: 1945, exams_conducted: 156, leak_incidents: 0, verified: true, verification_date: '2025-11-15T10:00:00+05:30' },
  { id: 'iiser-pun', name: 'Indian Institute of Science Education & Research Pune', short_name: 'IISER Pune', tier: 'PREMIER_VERIFIED', location: 'Pune, Maharashtra', established_year: 2006, exams_conducted: 89, leak_incidents: 0, verified: true, verification_date: '2025-11-20T10:00:00+05:30' },
  { id: 'iit-hyd', name: 'Indian Institute of Technology Hyderabad', short_name: 'IIT Hyderabad', tier: 'PREMIER_VERIFIED', location: 'Hyderabad, Telangana', established_year: 2008, exams_conducted: 98, leak_incidents: 0, verified: true, verification_date: '2025-11-15T10:00:00+05:30' },
  { id: 'iit-bhu', name: 'Indian Institute of Technology (BHU) Varanasi', short_name: 'IIT BHU', tier: 'PREMIER_VERIFIED', location: 'Varanasi, Uttar Pradesh', established_year: 1919, exams_conducted: 375, leak_incidents: 0, verified: true, verification_date: '2025-11-15T10:00:00+05:30' },
  { id: 'aiims-del', name: 'All India Institute of Medical Sciences', short_name: 'AIIMS Delhi', tier: 'PREMIER_VERIFIED', location: 'New Delhi, Delhi', established_year: 1956, exams_conducted: 445, leak_incidents: 0, verified: true, verification_date: '2025-11-15T10:00:00+05:30' },
];

// ── Setter Metadata (Paper Mode 1 — Transparency) ──

export const mockSetterMetadata: SetterMetadata = {
  setter_name: 'Prof. Arvind Krishnamurthy',
  setter_designation: 'Professor & Head of Department',
  setter_department: 'Department of Computer Science & Engineering',
  setter_institution: 'Indian Institute of Technology Bombay',
  setter_institution_id: 'iit-bom',
  setter_email_masked: 'a****y@iitb.ac.in',
  setter_id_proof_type: 'Aadhaar (Masked)',
  setter_id_proof_ref_masked: 'XXXX-XXXX-7834',
  paper_created_at: '2026-05-20T14:30:00+05:30',
  paper_locked_at: '2026-06-04T09:00:00+05:30',
  paper_lock_tx: '0x9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b',
  institution_trust_score: 100,
  institution_track_record_years: 68,
  institution_leak_incidents: 0,
};

// ── PYQ Uploads (Paper Mode 3) ──

export const mockPYQs: PYQUpload[] = [
  { id: 'pyq-001', filename: 'JEE_Advanced_2025_Paper1.pdf', exam_name: 'JEE Advanced 2025', year: 2025, subject: 'Physics', question_count: 18, uploaded_at: '2026-06-01T10:00:00+05:30' },
  { id: 'pyq-002', filename: 'JEE_Advanced_2025_Paper2.pdf', exam_name: 'JEE Advanced 2025', year: 2025, subject: 'Chemistry', question_count: 18, uploaded_at: '2026-06-01T10:05:00+05:30' },
  { id: 'pyq-003', filename: 'JEE_Advanced_2024_Paper1.pdf', exam_name: 'JEE Advanced 2024', year: 2024, subject: 'Mathematics', question_count: 18, uploaded_at: '2026-06-01T10:10:00+05:30' },
  { id: 'pyq-004', filename: 'NEET_2025_Physics.pdf', exam_name: 'NEET UG 2025', year: 2025, subject: 'Physics', question_count: 45, uploaded_at: '2026-06-01T10:15:00+05:30' },
  { id: 'pyq-005', filename: 'NEET_2024_Biology.pdf', exam_name: 'NEET UG 2024', year: 2024, subject: 'Biology', question_count: 90, uploaded_at: '2026-06-01T10:20:00+05:30' },
  { id: 'pyq-006', filename: 'ISI_Entrance_2025.pdf', exam_name: 'ISI Entrance 2025', year: 2025, subject: 'Mathematics', question_count: 30, uploaded_at: '2026-06-02T09:00:00+05:30' },
];

// ── Syllabus Configs (Paper Mode 3) ──

export const mockSyllabusConfigs: SyllabusConfig[] = [
  {
    id: 'syl-jee', name: 'JEE Advanced Syllabus', exam_type: 'JEE_ADVANCED',
    topics: [
      { name: 'Mechanics', subtopics: ['Kinematics', 'Laws of Motion', 'Work-Energy', 'Rotational Dynamics', 'Gravitation'], weight_percentage: 20, selected: true },
      { name: 'Electromagnetism', subtopics: ['Electrostatics', 'Current Electricity', 'Magnetism', 'EMI', 'AC Circuits'], weight_percentage: 22, selected: true },
      { name: 'Optics & Waves', subtopics: ['Ray Optics', 'Wave Optics', 'SHM', 'Sound Waves'], weight_percentage: 15, selected: true },
      { name: 'Thermodynamics', subtopics: ['Heat Transfer', 'KTG', 'Laws of Thermodynamics'], weight_percentage: 12, selected: true },
      { name: 'Modern Physics', subtopics: ['Photoelectric Effect', 'Atomic Models', 'Nuclear Physics', 'Semiconductors'], weight_percentage: 16, selected: true },
      { name: 'Organic Chemistry', subtopics: ['Hydrocarbons', 'Functional Groups', 'Reaction Mechanisms', 'Biomolecules'], weight_percentage: 15, selected: false },
    ],
  },
  {
    id: 'syl-neet', name: 'NEET UG Syllabus', exam_type: 'NEET',
    topics: [
      { name: 'Physics', subtopics: ['Mechanics', 'Optics', 'Electrodynamics', 'Thermodynamics', 'Modern Physics'], weight_percentage: 25, selected: true },
      { name: 'Chemistry', subtopics: ['Organic', 'Inorganic', 'Physical Chemistry'], weight_percentage: 25, selected: true },
      { name: 'Botany', subtopics: ['Plant Physiology', 'Morphology', 'Cell Biology', 'Ecology'], weight_percentage: 25, selected: true },
      { name: 'Zoology', subtopics: ['Human Physiology', 'Genetics', 'Evolution', 'Animal Kingdom'], weight_percentage: 25, selected: true },
    ],
  },
];
