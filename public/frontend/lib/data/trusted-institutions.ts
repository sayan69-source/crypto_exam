import type { TrustedInstitution } from '@/lib/api/types';

/**
 * Curated allow-list of premier institutions trusted to set papers. This is
 * reference data (genuine institutions), NOT runtime mock — there is no backend
 * table for it; the platform ships a fixed, auditable roster. The per-institution
 * activity figures are illustrative until an institution-registry service exists.
 */
export const TRUSTED_INSTITUTIONS: TrustedInstitution[] = [
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
