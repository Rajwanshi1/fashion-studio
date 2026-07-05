-- Google sign-in: password becomes optional; track how each account authenticates.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE users ADD COLUMN auth_provider text NOT NULL DEFAULT 'password'
  CHECK (auth_provider IN ('password','google'));
