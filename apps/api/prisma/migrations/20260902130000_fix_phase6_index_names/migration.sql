-- Several indexes were declared with names longer than PostgreSQL's 63-byte identifier limit, so
-- the server truncated them on creation and dropped the trailing "_idx". Prisma derives a shorter
-- name from the schema instead, which left `migrate diff` reporting drift in both directions and
-- would have failed CI's drift step. The already-applied migrations are never edited, so this
-- renames the truncated indexes to the names the schema expects.
ALTER INDEX "stock_movements_organization_id_item_id_warehouse_id_movement_d"
  RENAME TO "stock_movements_organization_id_item_id_warehouse_id_moveme_idx";

ALTER INDEX "valuation_layers_organization_id_item_id_warehouse_id_layer_dat"
  RENAME TO "valuation_layers_organization_id_item_id_warehouse_id_layer_idx";

ALTER INDEX "inventory_adjustments_organization_id_status_adjustment_date_id"
  RENAME TO "inventory_adjustments_organization_id_status_adjustment_dat_idx";
