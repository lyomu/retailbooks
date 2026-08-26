CREATE TYPE "InventoryValuationMethod" AS ENUM ('FIFO', 'WEIGHTED_AVERAGE');
CREATE TYPE "WarehouseStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "StockMovementDirection" AS ENUM ('IN', 'OUT');
CREATE TYPE "StockMovementSourceType" AS ENUM ('PURCHASE_RECEIPT', 'SALES_ISSUE', 'ADJUSTMENT', 'TRANSFER');
CREATE TYPE "InventoryAdjustmentStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'VOID', 'CANCELLED');

ALTER TYPE "AttachmentEntityType" ADD VALUE 'INVENTORY_ADJUSTMENT';

ALTER TABLE "organization_preferences"
  ADD COLUMN "inventory_valuation_method" "InventoryValuationMethod" NOT NULL DEFAULT 'FIFO';

ALTER TABLE "items"
  ADD COLUMN "purchase_account_id" UUID,
  ADD COLUMN "default_purchase_tax_code_id" UUID,
  ADD COLUMN "inventory_tracked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reorder_threshold" DECIMAL(18,4),
  ADD COLUMN "reorder_quantity" DECIMAL(18,4),
  ADD COLUMN "preferred_vendor_id" UUID;

ALTER TABLE "items"
  ADD CONSTRAINT "items_purchase_account_id_fkey"
  FOREIGN KEY ("purchase_account_id") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "items_default_purchase_tax_code_id_fkey"
  FOREIGN KEY ("default_purchase_tax_code_id") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "items_preferred_vendor_id_fkey"
  FOREIGN KEY ("preferred_vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "items_organization_id_inventory_tracked_idx" ON "items"("organization_id", "inventory_tracked");

CREATE TABLE "warehouses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "code" VARCHAR(32) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "address" VARCHAR(240),
  "status" "WarehouseStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "warehouses_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "warehouses_organization_id_code_key" ON "warehouses"("organization_id", "code");
CREATE INDEX "warehouses_organization_id_status_idx" ON "warehouses"("organization_id", "status");

CREATE TABLE "valuation_layers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "item_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "source_type" "StockMovementSourceType" NOT NULL,
  "source_id" UUID NOT NULL,
  "source_line_id" UUID,
  "layer_date" DATE NOT NULL,
  "quantity_in" DECIMAL(18,4) NOT NULL,
  "quantity_remaining" DECIMAL(18,4) NOT NULL,
  "unit_cost_minor" BIGINT NOT NULL,
  "cost_remaining_minor" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "valuation_layers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "valuation_layers_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "valuation_layers_item_id_fkey"
    FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "valuation_layers_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "valuation_layers_organization_id_item_id_warehouse_id_layer_date_idx"
  ON "valuation_layers"("organization_id", "item_id", "warehouse_id", "layer_date");
CREATE INDEX "valuation_layers_organization_id_source_type_source_id_idx"
  ON "valuation_layers"("organization_id", "source_type", "source_id");

CREATE TABLE "stock_movements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "item_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "movement_date" DATE NOT NULL,
  "direction" "StockMovementDirection" NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL,
  "unit_cost_minor" BIGINT NOT NULL DEFAULT 0,
  "total_cost_minor" BIGINT NOT NULL DEFAULT 0,
  "source_type" "StockMovementSourceType" NOT NULL,
  "source_id" UUID NOT NULL,
  "source_line_id" UUID,
  "valuation_layer_id" UUID,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_movements_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stock_movements_item_id_fkey"
    FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_movements_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_movements_valuation_layer_id_fkey"
    FOREIGN KEY ("valuation_layer_id") REFERENCES "valuation_layers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "stock_movements_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "stock_movements_organization_id_item_id_warehouse_id_movement_date_idx"
  ON "stock_movements"("organization_id", "item_id", "warehouse_id", "movement_date");
CREATE INDEX "stock_movements_organization_id_source_type_source_id_idx"
  ON "stock_movements"("organization_id", "source_type", "source_id");

CREATE TABLE "inventory_adjustments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "item_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "adjustment_date" DATE NOT NULL,
  "quantity_delta" DECIMAL(18,4) NOT NULL,
  "value_delta_minor" BIGINT NOT NULL DEFAULT 0,
  "reason" VARCHAR(240) NOT NULL,
  "account_id" UUID,
  "status" "InventoryAdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
  "journal_id" UUID,
  "created_by_user_id" UUID NOT NULL,
  "approved_by_user_id" UUID,
  "posted_by_user_id" UUID,
  "voided_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_adjustments_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_adjustments_item_id_fkey"
    FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_adjustments_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_adjustments_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_adjustments_journal_id_fkey"
    FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_adjustments_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_adjustments_approved_by_user_id_fkey"
    FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_adjustments_posted_by_user_id_fkey"
    FOREIGN KEY ("posted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "inventory_adjustments_journal_id_key" ON "inventory_adjustments"("journal_id");
CREATE INDEX "inventory_adjustments_organization_id_status_adjustment_date_idx"
  ON "inventory_adjustments"("organization_id", "status", "adjustment_date");
CREATE INDEX "inventory_adjustments_organization_id_item_id_warehouse_id_idx"
  ON "inventory_adjustments"("organization_id", "item_id", "warehouse_id");

ALTER TABLE "invoice_lines" ADD COLUMN "warehouse_id" UUID;
ALTER TABLE "quote_lines" ADD COLUMN "warehouse_id" UUID;
ALTER TABLE "sales_order_lines" ADD COLUMN "warehouse_id" UUID;
ALTER TABLE "recurring_invoice_template_lines" ADD COLUMN "warehouse_id" UUID;
ALTER TABLE "purchase_order_lines" ADD COLUMN "warehouse_id" UUID;
ALTER TABLE "bill_lines" ADD COLUMN "warehouse_id" UUID;
ALTER TABLE "recurring_bill_template_lines" ADD COLUMN "warehouse_id" UUID;

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_lines"
  ADD CONSTRAINT "quote_lines_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order_lines"
  ADD CONSTRAINT "sales_order_lines_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recurring_invoice_template_lines"
  ADD CONSTRAINT "recurring_invoice_template_lines_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bill_lines"
  ADD CONSTRAINT "bill_lines_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recurring_bill_template_lines"
  ADD CONSTRAINT "recurring_bill_template_lines_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
