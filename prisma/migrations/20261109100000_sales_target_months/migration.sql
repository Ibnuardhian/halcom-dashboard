-- Additive: a monthly gross-profit target beside the quarterly one. Nothing is copied or converted; a month with no row has no target set.
CREATE TABLE "sales_target_months" (
    "id" UUID NOT NULL,
    "sales_user_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "gross_profit_target" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_target_months_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_target_months_sales_user_id_year_month_key" ON "sales_target_months"("sales_user_id", "year", "month");
CREATE INDEX "sales_target_months_year_idx" ON "sales_target_months"("year");

ALTER TABLE "sales_target_months" ADD CONSTRAINT "sales_target_months_sales_user_id_fkey" FOREIGN KEY ("sales_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_target_months" ADD CONSTRAINT "sales_target_months_month_chk" CHECK ("month" BETWEEN 1 AND 12);
ALTER TABLE "sales_target_months" ADD CONSTRAINT "sales_target_months_year_chk" CHECK ("year" BETWEEN 2000 AND 2100);
ALTER TABLE "sales_target_months" ADD CONSTRAINT "sales_target_months_not_negative_chk" CHECK ("gross_profit_target" >= 0);
