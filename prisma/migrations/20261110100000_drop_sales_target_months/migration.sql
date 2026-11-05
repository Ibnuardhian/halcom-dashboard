-- Targets are entered per quarter again (the monthly table of 20261109100000 was never used for real data). The drop refuses to run if
-- someone did save monthly targets, so nothing is lost silently.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "sales_target_months") THEN
    RAISE EXCEPTION 'sales_target_months holds rows; move them to sales_targets first';
  END IF;
END $$;
DROP TABLE "sales_target_months";
