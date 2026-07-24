-- Phone-first identity: customers can exist (and log in) by phone alone.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN phone text;
ALTER TABLE users ADD COLUMN phone_verified boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX users_phone_unique ON users(phone) WHERE phone IS NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_email_or_phone CHECK (email IS NOT NULL OR phone IS NOT NULL);

ALTER TABLE users DROP CONSTRAINT users_auth_provider_check;
ALTER TABLE users ADD CONSTRAINT users_auth_provider_check
  CHECK (auth_provider IN ('password','google','otp'));

-- One-time login codes. Verification state lives here, never on users.
CREATE TABLE phone_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,                 -- E.164
  code_hash text NOT NULL,             -- sha256(code:phone:pepper)
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_phone_otps_phone ON phone_otps(phone, created_at DESC);
