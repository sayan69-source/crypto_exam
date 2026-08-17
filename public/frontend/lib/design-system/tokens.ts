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
    950: '#150e0e',
    900: '#1a1010',
    800: '#201515',
    700: '#2b211c',
    600: '#3d332c',
    500: '#605d52',
    400: '#939084',
    300: '#939084',
    200: '#c5c0b1',
    100: '#ddd8cc',
    50:  '#f8f4f0',
  },
  saffron: {
    700: '#7a2600',
    600: '#cc3f00',
    500: '#ff4f00',
    400: '#ff7433',
    300: '#ffa375',
    200: '#ffd4bf',
    100: '#fff0e8',
  },
  india: {
    saffron:     '#FF9933',   // Tricolour — top stripe
    #fffefb:       '#fffefb',
    green:       '#138808',   // Tricolour — bottom stripe
    ashoka:      '#201515',   // Ashoka Chakra navy
    gold:        '#b07d1a',   // ZK proof achievement badges
    deepSaffron: '#ff7433',   // Exam lock confirmation
  },
  success: {
    DEFAULT: '#3f6f4a',
    light:   '#e8efe6',
    text:    '#2f5438',
  },
  warning: {
    DEFAULT: '#b07d1a',
    light:   '#fdf6e8',
    text:    '#7d5610',
  },
  danger: {
    DEFAULT: '#9b2226',
    light:   '#f7e3dd',
    text:    '#7a1a1d',
  },
  info: {
    DEFAULT: '#6b5d4f',
    light:   '#f2ede5',
    text:    '#4a3f34',
  },
  blockchain: {
    confirmed:   '#3f6f4a',
    pending:     '#b07d1a',
    unconfirmed: '#939084',
    failed:      '#9b2226',
  },
  // Interface-specific backgrounds
  examBg:   '#fffefb',   // Candidate: calm, light
  setterBg: '#201515',   // Setter: dark professional
  adminBg:  '#150e0e',   // Admin: darkest, mission control
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
  sm:   '0 1px 2px 0 rgba(32, 21, 21, 0.05)',
  md:   '0 4px 6px -1px rgba(32, 21, 21, 0.1), 0 2px 4px -2px rgba(32, 21, 21, 0.1)',
  lg:   '0 10px 15px -3px rgba(32, 21, 21, 0.1), 0 4px 6px -4px rgba(32, 21, 21, 0.1)',
  xl:   '0 20px 25px -5px rgba(32, 21, 21, 0.1), 0 8px 10px -6px rgba(32, 21, 21, 0.1)',
  glow: '0 0 20px rgba(96, 93, 82, 0.15)',
  crypto: '0 0 30px rgba(176, 125, 26, 0.2)',
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
