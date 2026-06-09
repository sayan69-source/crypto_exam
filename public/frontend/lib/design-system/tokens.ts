/**
 * CryptoExam Core — Design System Tokens
 * 
 * § 4.2 — All three interfaces use these exact tokens.
 * Inconsistency loses Design & UX marks.
 * 
 * Color narrative:
 *   Saffron: Courage, energy — exam lock, warnings, CTAs
 *   White:   Truth, peace — candidate backgrounds
 *   Green:   Growth, auspiciousness — success, verified blockchain
 *   Navy:    Trust, depth — headers, primary actions, data surfaces
 *   Gold:    Achievement — ZK proof badge, top scores
 */

// ── Color Tokens ──

export const colors = {
  navy: {
    950: '#080E1E',
    900: '#0D1526',
    800: '#132040',
    700: '#1A2D5A',
    600: '#213573',
    500: '#2942A6',
    400: '#3D5CBE',
    300: '#6B84D4',
    200: '#A8B9EA',
    100: '#D8DEF4',
    50:  '#EFF1FA',
  },
  saffron: {
    700: '#7B3000',
    600: '#C45C00',
    500: '#E07020',
    400: '#F09040',
    300: '#F8B870',
    200: '#FDDCB0',
    100: '#FEF0E0',
  },
  india: {
    saffron:     '#FF9933',   // Tricolour — top stripe
    white:       '#FFFFFF',
    green:       '#138808',   // Tricolour — bottom stripe
    ashoka:      '#000080',   // Ashoka Chakra navy
    gold:        '#C9A84C',   // ZK proof achievement badges
    deepSaffron: '#F4833A',   // Exam lock confirmation
  },
  success: {
    DEFAULT: '#1A7A4C',
    light:   '#D1FAE5',
    text:    '#065F46',
  },
  warning: {
    DEFAULT: '#C47A1E',
    light:   '#FEF3C7',
    text:    '#92400E',
  },
  danger: {
    DEFAULT: '#C82020',
    light:   '#FEE2E2',
    text:    '#991B1B',
  },
  info: {
    DEFAULT: '#1E6FA0',
    light:   '#DBEAFE',
    text:    '#1E40AF',
  },
  blockchain: {
    confirmed:   '#1A7A4C',
    pending:     '#C47A1E',
    unconfirmed: '#9A9A9A',
    failed:      '#C82020',
  },
  // Interface-specific backgrounds
  examBg:   '#F8F9FC',   // Candidate: calm, light
  setterBg: '#0F1319',   // Setter: dark professional
  adminBg:  '#090D14',   // Admin: darkest, mission control
} as const;


// ── Font Stacks ──

export const fonts = {
  sans:        ['Sora', 'Noto Sans Devanagari', 'Noto Sans', 'sans-serif'],
  mono:        ['JetBrains Mono', 'Fira Code', 'monospace'],
  display:     ['Instrument Serif', 'Sora', 'sans-serif'],
  devanagari:  ['Noto Sans Devanagari', 'Mangal', 'sans-serif'],
  tamil:       ['Noto Sans Tamil', 'sans-serif'],
  telugu:      ['Noto Sans Telugu', 'sans-serif'],
  bengali:     ['Noto Sans Bengali', 'sans-serif'],
  kannada:     ['Noto Sans Kannada', 'sans-serif'],
  malayalam:   ['Noto Sans Malayalam', 'sans-serif'],
  gujarati:    ['Noto Sans Gujarati', 'sans-serif'],
  odia:        ['Noto Sans Oriya', 'sans-serif'],
} as const;


// ── Animation Curves ──

export const animations = {
  cryptoReveal: 'cubic-bezier(0.16, 1, 0.3, 1) 500ms',
  lockDown:     'cubic-bezier(0.4, 0, 0.2, 1) 700ms',
  timerPulse:   'ease-in-out 1000ms infinite',
  indiaReveal:  'cubic-bezier(0.33, 1, 0.68, 1) 900ms',
  dashboardIn:  'cubic-bezier(0.0, 0.0, 0.2, 1.0) 300ms',
  blockConfirm: 'cubic-bezier(0.16, 1, 0.3, 1) 400ms',
} as const;


// ── Spacing Scale ──

export const spacing = {
  xs:  '4px',
  sm:  '8px',
  md:  '16px',
  lg:  '24px',
  xl:  '32px',
  '2xl': '48px',
  '3xl': '64px',
  '4xl': '96px',
} as const;


// ── Border Radii ──

export const radii = {
  sm:   '4px',
  md:   '8px',
  lg:   '12px',
  xl:   '16px',
  '2xl': '24px',
  full: '9999px',
} as const;


// ── Shadows ──

export const shadows = {
  sm:   '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  md:   '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
  lg:   '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
  xl:   '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
  glow: '0 0 20px rgba(41, 66, 166, 0.15)',
  crypto: '0 0 30px rgba(196, 168, 76, 0.2)',
} as const;


// ── Breakpoints ──

export const breakpoints = {
  sm:  '640px',
  md:  '768px',
  lg:  '1024px',
  xl:  '1280px',
  '2xl': '1536px',
} as const;


// ── Z-Index Scale ──

export const zIndex = {
  dropdown:  1000,
  sticky:    1100,
  overlay:   1200,
  modal:     1300,
  popover:   1400,
  toast:     1500,
  tooltip:   1600,
  antiCheat: 9000,   // Anti-cheat overlays above everything
  emergency: 9999,   // Emergency broadcast above all
} as const;


// ── Typography Scale ──

export const typography = {
  heading: {
    h1: { size: '36px', weight: 700, lineHeight: 1.2 },
    h2: { size: '28px', weight: 600, lineHeight: 1.3 },
    h3: { size: '22px', weight: 600, lineHeight: 1.4 },
    h4: { size: '18px', weight: 600, lineHeight: 1.5 },
  },
  body: {
    lg: { size: '18px', weight: 400, lineHeight: 1.75 },
    md: { size: '16px', weight: 400, lineHeight: 1.6 },
    sm: { size: '14px', weight: 400, lineHeight: 1.5 },
    xs: { size: '12px', weight: 400, lineHeight: 1.4 },
  },
  mono: {
    lg: { size: '18px', weight: 400, lineHeight: 1.5 },
    md: { size: '14px', weight: 400, lineHeight: 1.5 },
    sm: { size: '12px', weight: 400, lineHeight: 1.4 },
  },
  // Devanagari/regional scripts need larger minimum size
  devanagari: {
    body: { size: '18px', weight: 400, lineHeight: 1.8 },
    heading: { size: '24px', weight: 600, lineHeight: 1.4 },
  },
} as const;
