/**
 * CryptoExam Core — CSS Custom Properties Generator
 * 
 * Converts TypeScript design tokens into CSS custom properties
 * for use across all three interfaces via vanilla CSS.
 */

import { colors, fonts, animations, spacing, radii, shadows } from './tokens';

/**
 * Generate CSS custom properties string from design tokens.
 * Injected into :root in the global stylesheet.
 */
export function generateCSSVariables(): string {
  const lines: string[] = [];

  // Colors — Navy
  for (const [shade, value] of Object.entries(colors.navy)) {
    lines.push(`  --color-navy-${shade}: ${value};`);
  }

  // Colors — Saffron
  for (const [shade, value] of Object.entries(colors.saffron)) {
    lines.push(`  --color-saffron-${shade}: ${value};`);
  }

  // Colors — India
  for (const [name, value] of Object.entries(colors.india)) {
    lines.push(`  --color-india-${name.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${value};`);
  }

  // Colors — Status
  const statusColors = { success: colors.success, warning: colors.warning, danger: colors.danger, info: colors.info };
  for (const [status, variants] of Object.entries(statusColors)) {
    for (const [variant, value] of Object.entries(variants)) {
      const suffix = variant === 'DEFAULT' ? '' : `-${variant}`;
      lines.push(`  --color-${status}${suffix}: ${value};`);
    }
  }

  // Colors — Blockchain
  for (const [state, value] of Object.entries(colors.blockchain)) {
    lines.push(`  --color-blockchain-${state}: ${value};`);
  }

  // Interface backgrounds
  lines.push(`  --bg-exam: ${colors.examBg};`);
  lines.push(`  --bg-setter: ${colors.setterBg};`);
  lines.push(`  --bg-admin: ${colors.adminBg};`);

  // Fonts
  for (const [name, stack] of Object.entries(fonts)) {
    lines.push(`  --font-${name}: ${stack.join(', ')};`);
  }

  // Spacing
  for (const [name, value] of Object.entries(spacing)) {
    lines.push(`  --space-${name}: ${value};`);
  }

  // Radii
  for (const [name, value] of Object.entries(radii)) {
    lines.push(`  --radius-${name}: ${value};`);
  }

  // Shadows
  for (const [name, value] of Object.entries(shadows)) {
    lines.push(`  --shadow-${name}: ${value};`);
  }

  return `:root {\n${lines.join('\n')}\n}`;
}

export { colors, fonts, animations, spacing, radii, shadows };
