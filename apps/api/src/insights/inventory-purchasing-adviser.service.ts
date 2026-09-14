import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';

export interface PurchasingAdvice {
  readonly itemId: string;
  readonly itemName: string;
  readonly warehouseName: string;
  readonly quantityOnHand: string;
  readonly reorderPoint: string;
  readonly suggestedOrderQuantity: string;
  readonly averageDailyOutflow: number;
  readonly daysOfStockRemaining: number | null;
  readonly urgent: boolean;
}

const SALES_PACE_WINDOW_DAYS = 30;
const URGENT_DAYS_THRESHOLD = 14;

/**
 * Deterministic reorder advice: stock-on-hand and reorder point are the same immutable stock-
 * movement/item-setting figures `inventory.reorder` already reports; this adds a real
 * days-of-stock-remaining estimate from the last 30 days' actual outflow pace. No model call, no
 * invented lead time -- lead time isn't a field this schema tracks, so it's left out rather than
 * guessed at.
 */
@Injectable()
export class InventoryPurchasingAdviserService {
  constructor(private readonly prisma: PrismaService) {}

  async advise(organizationId: string): Promise<PurchasingAdvice[]> {
    const windowStart = addDays(new Date(), -SALES_PACE_WINDOW_DAYS);

    const rows = await this.prisma.$queryRaw<
      {
        itemId: string;
        itemName: string;
        warehouseName: string;
        quantityOnHand: string;
        reorderPoint: string;
        suggestedOrderQuantity: string;
        outflow30d: string;
      }[]
    >(Prisma.sql`
      WITH on_hand AS (
        SELECT sm.item_id, sm.warehouse_id,
               SUM(CASE WHEN sm.direction = 'IN' THEN sm.quantity ELSE -sm.quantity END) AS quantity
        FROM stock_movements sm
        WHERE sm.organization_id = ${organizationId}::uuid
        GROUP BY sm.item_id, sm.warehouse_id
      ),
      recent_outflow AS (
        SELECT sm.item_id, sm.warehouse_id, SUM(sm.quantity) AS outflow
        FROM stock_movements sm
        WHERE sm.organization_id = ${organizationId}::uuid AND sm.direction = 'OUT'
          AND sm.movement_date >= ${windowStart}::date
        GROUP BY sm.item_id, sm.warehouse_id
      )
      SELECT it.id::text AS "itemId", it.name AS "itemName", w.name AS "warehouseName",
             on_hand.quantity::text AS "quantityOnHand",
             COALESCE(it.reorder_threshold, 0)::text AS "reorderPoint",
             GREATEST(
               COALESCE(it.reorder_quantity, 0),
               COALESCE(it.reorder_threshold, 0) - on_hand.quantity
             )::text AS "suggestedOrderQuantity",
             COALESCE(recent_outflow.outflow, 0)::text AS "outflow30d"
      FROM on_hand
      JOIN items it ON it.id = on_hand.item_id AND it.organization_id = ${organizationId}::uuid
      JOIN warehouses w ON w.id = on_hand.warehouse_id AND w.organization_id = ${organizationId}::uuid
      LEFT JOIN recent_outflow
        ON recent_outflow.item_id = on_hand.item_id AND recent_outflow.warehouse_id = on_hand.warehouse_id
      WHERE on_hand.quantity::numeric <= COALESCE(it.reorder_threshold, 0)::numeric
      ORDER BY it.name, w.name
    `);

    return rows.map((row) => {
      const averageDailyOutflow = Number(row.outflow30d) / SALES_PACE_WINDOW_DAYS;
      const daysOfStockRemaining =
        averageDailyOutflow > 0 ? Number(row.quantityOnHand) / averageDailyOutflow : null;
      return {
        itemId: row.itemId,
        itemName: row.itemName,
        warehouseName: row.warehouseName,
        quantityOnHand: row.quantityOnHand,
        reorderPoint: row.reorderPoint,
        suggestedOrderQuantity: row.suggestedOrderQuantity,
        averageDailyOutflow,
        daysOfStockRemaining,
        urgent: daysOfStockRemaining !== null && daysOfStockRemaining < URGENT_DAYS_THRESHOLD,
      };
    });
  }
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
