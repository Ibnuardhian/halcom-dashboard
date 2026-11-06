-- A person with one working role (Sales, SOA, ...) who may also see what Management sees (read only). Off for everybody until a superadmin turns it on.
ALTER TABLE "users" ADD COLUMN "also_management" BOOLEAN NOT NULL DEFAULT false;
