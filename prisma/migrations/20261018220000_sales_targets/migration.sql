-- CreateTable
CREATE TABLE "sales_targets" (
    "id" UUID NOT NULL,
    "sales_user_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "revenue_target" DECIMAL(18,2),
    "gross_profit_target" DECIMAL(18,2),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_targets_year_idx" ON "sales_targets"("year");

-- CreateIndex
CREATE UNIQUE INDEX "sales_targets_sales_user_id_year_quarter_key" ON "sales_targets"("sales_user_id", "year", "quarter");

-- AddForeignKey
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_sales_user_id_fkey" FOREIGN KEY ("sales_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules the application also enforces.
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_quarter_chk" CHECK ("quarter" BETWEEN 1 AND 4);
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_year_chk" CHECK ("year" BETWEEN 2000 AND 2100);
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_not_negative_chk"
  CHECK (COALESCE("revenue_target", 0) >= 0 AND COALESCE("gross_profit_target", 0) >= 0);
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_has_target_chk"
  CHECK ("revenue_target" IS NOT NULL OR "gross_profit_target" IS NOT NULL);
