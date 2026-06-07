/**
 * CryptoExam Core — API Type Definitions
 * TypeScript interfaces for all API entities
 */

// ── Enums ──

export type UserRole = 'CANDIDATE' | 'SETTER' | 'ADMIN';

export type ExamType = 'ONLINE_CBT' | 'OFFLINE_HARDWARE' | 'HYBRID';

export type ExamBody = 'NTA' | 'UPSC' | 'SSC' | 'IBPS' | 'STATE_PSC' | 'CBSE' | 'CUSTOM';

export type ExamStatus =
  | 'DRAFT' | 'GENERATING' | 'PROOF_PENDING' | 'LOCKED'
  | 'DISTRIBUTED' | 'LIVE' | 'PAUSED' | 'COMPLETED' | 'AUDITED' | 'ABORTED';

export type NodeStatus =
  | 'OFFLINE' | 'ARMED' | 'DECRYPTING' | 'COMPLETE' | 'ERROR' | 'TAMPER_BREACH';

export type QuestionSource = 'AI_GENERATED' | 'AI_HYBRID' | 'MANUAL_UPLOAD';

export type AnomalyType =
  | 'TAB_SWITCH' | 'FACE_FAIL' | 'NETWORK_DROP' | 'NODE_OFFLINE'
  | 'COPY_ATTEMPT' | 'SUSPICIOUS_TIMING' | 'FULLSCREEN_EXIT'
  | 'VM_DETECTED' | 'BLUETOOTH_DETECTED' | 'SCREEN_RECORD_ATTEMPT';

export type EnrollmentStatus = 'ENROLLED' | 'PRESENT' | 'ABSENT' | 'DISQUALIFIED';

export type ConnectivityTier = 'TIER_1_METRO' | 'TIER_2_4G' | 'TIER_3_BSNL' | 'TIER_4_OFFLINE';

export type BlockchainTxStatus = 'confirmed' | 'pending' | 'unconfirmed' | 'failed';

export type BloomsLevel = 1 | 2 | 3 | 4 | 5 | 6;

// ── Core Entities ──

export interface User {
  id: string;
  email?: string;
  phone?: string;
  role: UserRole;
  full_name: string;
  name_hi?: string;
  locale: string;
  institution?: string;
  state?: string;
  district?: string;
  dpdp_consent: boolean;
  is_active: boolean;
  created_at: string;
}

export interface Exam {
  id: string;
  name: string;
  name_hi?: string;
  exam_body: ExamBody;
  subject_taxonomy: SubjectTaxonomy;
  exam_type: ExamType;
  duration_minutes: number;
  scheduled_at: string;
  status: ExamStatus;
  setter_id: string;
  sets_count: number;
  negative_marking: number;
  irt_config: IRTConfig;
  blooms_config: BloomsConfig;
  question_hash?: string;
  zk_proof_hash?: string;
  zk_proof_ipfs?: string;
  drand_round?: number;
  polygon_exam_tx?: string;
  polygon_zkproof_tx?: string;
  answer_merkle_root?: string;
  polygon_answer_tx?: string;
  candidate_count?: number;
  centers_count?: number;
  created_at: string;
}

export interface SubjectTaxonomy {
  subjects: SubjectConfig[];
}

export interface SubjectConfig {
  name: string;
  name_hi?: string;
  topics: string[];
  question_count: number;
}

export interface IRTConfig {
  target_mean_b: number;
  target_std_b: number;
  min_a: number;
  max_c: number;
  tolerance: number;
}

export interface BloomsConfig {
  targets: Record<string, number>; // level -> percentage
}

export interface Question {
  id: string;
  exam_id: string;
  set_label: string;
  sequence_number: number;
  text: string;
  text_hi?: string;
  options: { A: string; B: string; C: string; D: string };
  options_hi?: { A: string; B: string; C: string; D: string };
  correct_option: string;
  subject: string;
  topic: string;
  blooms_level: BloomsLevel;
  irt_b: number;
  irt_a: number;
  irt_c: number;
  source: QuestionSource;
  is_accepted: boolean;
}

export interface Center {
  id: string;
  name: string;
  state: string;
  district: string;
  city: string;
  address: string;
  pincode: string;
  latitude: number;
  longitude: number;
  capacity: number;
  invigilator_name: string;
  invigilator_phone: string;
  connectivity: ConnectivityTier;
  isp: string;
  status?: 'healthy' | 'degraded' | 'incident' | 'inactive';
  candidates_present?: number;
  candidates_total?: number;
}

export interface HardwareNode {
  id: string;
  center_id: string;
  center_name?: string;
  serial_number: string;
  status: NodeStatus;
  tpm_ok: boolean;
  gps_ok: boolean;
  atecc_ok: boolean;
  tamper_mesh_ok: boolean;
  firmware_version: string;
  last_heartbeat: string;
  battery_percent: number;
  timelock_status?: string;
  timelock_remaining?: number;
}

export interface Session {
  id: string;
  enrollment_id: string;
  started_at?: string;
  ended_at?: string;
  is_submitted: boolean;
  is_disqualified: boolean;
  answer_hash?: string;
  merkle_leaf?: string;
  merkle_proof_path?: string[];
  tab_switch_count: number;
  receipt_tx?: string;
}

export interface Anomaly {
  id: string;
  session_id?: string;
  exam_id: string;
  center_id?: string;
  center_name?: string;
  candidate_name?: string;
  type: AnomalyType;
  severity: 1 | 2 | 3 | 4 | 5;
  details: Record<string, unknown>;
  resolved: boolean;
  created_at: string;
}

export interface BlockchainEvent {
  type: 'ExamCreated' | 'PaperLocked' | 'ZKProofSubmitted' | 'ExamStarted' | 'AnswerRootCommitted' | 'ProofOfDelivery';
  tx_hash: string;
  block_number: number;
  timestamp: string;
  exam_id?: string;
  status: BlockchainTxStatus;
  decoded_data?: Record<string, unknown>;
}

export interface CryptoReceipt {
  candidate_name: string;
  roll_number: string;
  exam_name: string;
  exam_body: ExamBody;
  exam_date: string;
  entered_at: string;
  submitted_at: string;
  duration_elapsed: string;
  answer_merkle_root: string;
  polygon_answer_tx: string;
  block_number: number;
  block_timestamp: string;
  zk_proof_verified: boolean;
  zk_proof_tx?: string;
  merkle_leaf: string;
  merkle_proof_path: string[];
  answers_summary: AnswerSummaryItem[];
}

export interface AnswerSummaryItem {
  question_number: number;
  section: string;
  status: 'answered' | 'flagged_answered' | 'skipped';
  time_spent_seconds: number;
}

export interface DashboardMetrics {
  candidates_online: number;
  centers_healthy: number;
  centers_total: number;
  blockchain_tps: number;
  active_anomalies: number;
  live_exams: LiveExamSummary[];
}

export interface LiveExamSummary {
  id: string;
  name: string;
  time_remaining_seconds: number;
  candidates_online: number;
  candidates_total: number;
  centers_healthy: number;
  centers_total: number;
  anomaly_count: number;
  status: ExamStatus;
  health: 'healthy' | 'degraded' | 'incident';
}

export interface IntegrityReport {
  exam_id: string;
  question_hash_matches: boolean;
  zk_proof_valid: boolean;
  paper_locked_before_t0: boolean;
  answer_merkle_committed: boolean;
  proof_of_delivery: boolean;
  overall_verdict: 'INTEGRITY_VERIFIED' | 'INTEGRITY_FAILURE';
  details: IntegrityCheckItem[];
}

export interface IntegrityCheckItem {
  label: string;
  passed: boolean;
  timestamp?: string;
  tx_hash?: string;
  detail?: string;
}

// ── API Response Wrappers ──

export interface ApiResponse<T> {
  data: T;
  message?: string;
  status: 'success' | 'error';
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}
