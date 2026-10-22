-- A completed BOQ can be revised: SOA drag it to the Revision column. Additive: one new enum value, no row is rewritten.
-- WAITING_FOR_SALES stays in the enum (the application no longer offers it) so existing requests and their append-only status
-- history keep a valid value; PostgreSQL cannot drop an enum value without rewriting those rows.
ALTER TYPE "RequestStatus" ADD VALUE IF NOT EXISTS 'REVISION';
