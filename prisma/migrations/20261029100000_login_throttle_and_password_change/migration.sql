-- Production blockers T-7 and T-9: slow down password guessing, and make an account whose password somebody else chose
-- change it at the first sign-in. Additive: no column or table is dropped, and every existing account keeps its password.

-- T-9. False for the accounts that exist: they chose their own password, or the owner will reset it on purpose.
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- T-7. Failed sign-ins per e-mail and per client address. Not history: a row is updated on every attempt and deleted on a
-- successful sign-in, so it holds no record of who signed in, only what is still being counted.
CREATE TABLE "login_attempts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    -- 'email' (the address that was typed, whether or not it belongs to an account) or 'ip' (a SHA-256 of the client address).
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "first_failed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_failed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(3),

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "login_attempts_scope_chk" CHECK ("scope" IN ('email', 'ip')),
    CONSTRAINT "login_attempts_failures_chk" CHECK ("failures" >= 0)
);

-- One row per scope and key; the sign-in upserts on it.
CREATE UNIQUE INDEX "login_attempts_scope_key_key" ON "login_attempts"("scope", "key");
-- Lets the clean-up of cold counters read only the rows it removes.
CREATE INDEX "login_attempts_last_failed_at_idx" ON "login_attempts"("last_failed_at");
