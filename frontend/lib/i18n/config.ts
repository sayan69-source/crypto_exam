/**
 * CryptoExam Core — Internationalisation Configuration
 * 
 * § 4.4 — India First. English + 9 Scheduled Languages.
 * All timestamps IST primary, UTC secondary.
 * DPDP Act 2023 consent rendered before ANY data collection.
 */

export const locales = ['en', 'hi', 'bn', 'te', 'ta', 'mr', 'gu', 'kn', 'ml', 'or'] as const;

export type Locale = typeof locales[number];

export const defaultLocale: Locale = 'en';

export const localeNames: Record<Locale, string> = {
  en: 'English',
  hi: 'हिंदी',
  bn: 'বাংলা',
  te: 'తెలుగు',
  ta: 'தமிழ்',
  mr: 'मराठी',
  gu: 'ગુજરાતી',
  kn: 'ಕನ್ನಡ',
  ml: 'മലയാളം',
  or: 'ଓଡ଼ିଆ',
};

/**
 * Font family for each locale's script.
 * Devanagari script for Hindi/Marathi: minimum 17px.
 */
export const localeFonts: Record<Locale, string> = {
  en: 'var(--font-sans)',
  hi: 'var(--font-devanagari)',
  bn: 'var(--font-bengali)',
  te: 'var(--font-telugu)',
  ta: 'var(--font-tamil)',
  mr: 'var(--font-devanagari)',
  gu: 'var(--font-gujarati)',
  kn: 'var(--font-kannada)',
  ml: 'var(--font-malayalam)',
  or: 'var(--font-odia)',
};

/**
 * Minimum font size for readability per script.
 * Devanagari, Tamil, Telugu, etc. need larger minimum sizes.
 */
export const localeMinFontSize: Record<Locale, number> = {
  en: 14,
  hi: 17,
  bn: 16,
  te: 16,
  ta: 16,
  mr: 17,
  gu: 16,
  kn: 16,
  ml: 16,
  or: 16,
};
