-- The starting list of industries a customer can be given. Admin and Superadmin edit it afterwards; a name that exists is left alone.
INSERT INTO "industries" ("name", "name_key") VALUES
  ('Public Sector & Government', 'public sector & government'),
  ('Manufacturing', 'manufacturing'),
  ('Retail & E-Commerce', 'retail & e-commerce'),
  ('Healthcare (Kesehatan)', 'healthcare (kesehatan)'),
  ('Telecommunications', 'telecommunications'),
  ('Financial Services', 'financial services'),
  ('Logistics & Transportation', 'logistics & transportation'),
  ('Education', 'education'),
  ('Hospitality & Tourism', 'hospitality & tourism'),
  ('Oil & Gas', 'oil & gas')
ON CONFLICT ("name_key") DO NOTHING;
