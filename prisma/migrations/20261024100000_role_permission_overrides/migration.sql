-- Role permission overrides: what the superadmin changed in the permission editor (additive; no existing table is touched).
-- Permissions stay defined in code. A role with no row here has the defaults, so after this migration every role can do exactly
-- what it could before. "permissions.manage" is a new permission in code that only the Superadmin role holds by default.
CREATE TABLE "role_permission_overrides" (
    "role" "Role" NOT NULL,
    "permission" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "role_permission_overrides_pkey" PRIMARY KEY ("role","permission")
);

ALTER TABLE "role_permission_overrides" ADD CONSTRAINT "role_permission_overrides_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
