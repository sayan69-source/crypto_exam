-- Migration: Add EmailOtpChallenge and EmailVerificationGrant
-- Creates tables for the mandatory email OTP verification flow

CREATE TABLE IF NOT EXISTS email_otp_challenges (
    id CHAR(36) PRIMARY KEY,
    email VARCHAR NOT NULL,
    purpose VARCHAR NOT NULL,
    role VARCHAR,
    code_hash VARCHAR NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    request_ip VARCHAR
);

CREATE INDEX IF NOT EXISTS ix_email_otp_challenges_email ON email_otp_challenges (email);
CREATE INDEX IF NOT EXISTS ix_email_otp_challenges_token ON email_otp_challenges (id);


CREATE TABLE IF NOT EXISTS email_verification_grants (
    token VARCHAR PRIMARY KEY,
    email VARCHAR NOT NULL,
    purpose VARCHAR NOT NULL,
    role VARCHAR,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_email_verification_grants_email ON email_verification_grants (email);
