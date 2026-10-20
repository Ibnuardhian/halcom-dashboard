-- A request code has room for a prefix of at most three characters (requests_code_format_chk), so the prefix of a person may not be longer.
-- The column was added empty in the previous migration, so no row can violate the tighter check.
ALTER TABLE "users" DROP CONSTRAINT "users_code_prefix_chk";
ALTER TABLE "users" ADD CONSTRAINT "users_code_prefix_chk" CHECK ("code_prefix" IS NULL OR "code_prefix" ~ '^[A-Z][A-Z0-9]{0,2}$');
