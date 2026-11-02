-- The industry belongs to the customer. Customers that have none take the one their projects carried from the sales export, when every
-- project of the customer names the same industry and it is on the list. Customers whose projects disagree are left for a person to choose.
-- The project column stays (nothing is deleted) but nothing reads it any more.
UPDATE "customers" c
SET industry = pick.name
FROM (
  SELECT p.customer_id, min(i.name) AS name
  FROM "projects" p
  LEFT JOIN "industries" i ON i.name_key = lower(regexp_replace(trim(p.industry), '\s+', ' ', 'g'))
  WHERE p.deleted_at IS NULL AND p.customer_id IS NOT NULL AND p.industry IS NOT NULL AND trim(p.industry) <> ''
  GROUP BY p.customer_id
  HAVING count(DISTINCT lower(regexp_replace(trim(p.industry), '\s+', ' ', 'g'))) = 1 AND count(i.name) = count(*)
) pick
WHERE c.id = pick.customer_id AND (c.industry IS NULL OR trim(c.industry) = '');
