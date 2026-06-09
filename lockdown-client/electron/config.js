/**
 * CryptoExam Lockdown Client — runtime configuration (§30).
 * Override via environment variables at launch (set by the per-centre installer).
 */
const EXAM_URL = process.env.ELECTRON_EXAM_URL || 'https://exam.cryptoexamcore.in';

module.exports = {
  EXAM_URL,
  ALLOWED_ORIGINS: (process.env.ELECTRON_ALLOWED_ORIGINS
    ? process.env.ELECTRON_ALLOWED_ORIGINS.split(',')
    : [
        'https://exam.cryptoexamcore.in',
        'https://api.cryptoexamcore.in',
        'https://cdn.cryptoexamcore.in',
        // dev convenience — only effective when ELECTRON_EXAM_URL points at localhost
        ...(EXAM_URL.startsWith('http://localhost') ? ['http://localhost:3000', 'http://localhost:8000'] : []),
      ]),
  // Signed at install time; sent as X-CryptoExam-Client so the server can reject browsers (§30.9)
  CLIENT_CERT_TOKEN: process.env.CLIENT_CERT_TOKEN || 'CXLC_dev-unsigned',
  // Allow exit without force-shutdown during development
  DEV_ALLOW_EXIT: process.env.ELECTRON_DEV_ALLOW_EXIT === '1',
};
