-- The industry of a customer (end-user company), filled in on the Customers page. Additive: one nullable column, nothing existing is touched.
-- Charts, filters and exports read it first and fall back to the free-text industry a project carried from the sales export.
ALTER TABLE "customers" ADD COLUMN "industry" TEXT;
