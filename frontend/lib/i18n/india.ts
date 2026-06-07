/**
 * CryptoExam Core — India-Specific Utilities
 * 
 * § 25.4 — IST timestamps, Indian number formatting, state registry.
 */

/**
 * Format date to IST (Indian Standard Time).
 * All timestamps shown as IST primary, UTC secondary.
 */
export function formatIST(date: Date): string {
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }) + ' IST';
}

/**
 * Format number in Indian system (Lakh / Crore).
 * "2.4M students" → "24 Lakh students"
 * "₹900 Crore" not "$108 million"
 */
export function formatIndian(n: number): string {
  if (n >= 10000000) return `${(n / 10000000).toFixed(1)} Cr`;
  if (n >= 100000) return `${(n / 100000).toFixed(1)} Lakh`;
  return n.toLocaleString('en-IN');
}

/**
 * Format currency in Indian Rupees.
 */
export function formatINR(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)} Lakh`;
  return `₹${n.toLocaleString('en-IN')}`;
}

/**
 * All 28 states + 8 UTs with correct administrative spellings.
 */
export const INDIA_STATES = [
  // States
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  // Union Territories
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi (NCT)', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
] as const;

export type IndiaState = typeof INDIA_STATES[number];

/**
 * Connectivity tiers for exam centers (matches DB enum).
 */
export const CONNECTIVITY_TIERS = {
  TIER_1_METRO: { label: 'Tier 1 — Metro Fibre', color: '#1A7A4C' },
  TIER_2_4G:    { label: 'Tier 2 — 4G', color: '#C47A1E' },
  TIER_3_BSNL:  { label: 'Tier 3 — BSNL', color: '#E07020' },
  TIER_4_OFFLINE:{ label: 'Tier 4 — Offline Node', color: '#C82020' },
} as const;

/**
 * Major exam bodies in India (matches DB enum).
 */
export const EXAM_BODIES = {
  NTA:       { name: 'National Testing Agency', abbr: 'NTA', exams: ['NEET UG', 'JEE Main', 'CUET UG/PG'] },
  UPSC:      { name: 'Union Public Service Commission', abbr: 'UPSC', exams: ['Civil Services', 'CDS', 'NDA'] },
  SSC:       { name: 'Staff Selection Commission', abbr: 'SSC', exams: ['CGL', 'CHSL', 'MTS'] },
  IBPS:      { name: 'Institute of Banking Personnel Selection', abbr: 'IBPS', exams: ['PO', 'Clerk', 'SO'] },
  STATE_PSC: { name: 'State Public Service Commission', abbr: 'State PSC', exams: ['Various'] },
  CBSE:      { name: 'Central Board of Secondary Education', abbr: 'CBSE', exams: ['Class 10', 'Class 12'] },
  CUSTOM:    { name: 'Custom Exam Body', abbr: 'Custom', exams: [] },
} as const;
