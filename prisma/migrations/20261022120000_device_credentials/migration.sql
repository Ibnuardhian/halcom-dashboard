-- An account remembered on one browser, so Switch Account does not ask for the password again (not offered to ADMIN and SUPERADMIN).
-- Additive: a new table. The cookie holds a random token and the id of this row; only a salted SHA-256 of the token is stored here, so a
-- database leak does not expose a usable credential. A row ends with its user (cascade), at its expiry, and when the password is
-- changed or reset or the account is deactivated.
CREATE TABLE "device_credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "salt" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),

    CONSTRAINT "device_credentials_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "device_credentials_user_id_idx" ON "device_credentials"("user_id");
CREATE INDEX "device_credentials_expires_at_idx" ON "device_credentials"("expires_at");

ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
