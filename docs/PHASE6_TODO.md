# RetailBooks Phase 6 (Inventory) implementation checklist

Durable progress record for Phase 6: Inventory. This phase started under the user-confirmed rule,
**code first, tests later**; after the code-first pass was committed, the verification pass was
opened and inventory integration coverage was added. `docs/BUILD_ROADMAP.md`'s Phase 6 section is
the rolled-up summary and should be synced at close-out.

## Scoping decisions made up front

1. **Phase 5 gate passed.** Phase 5 was committed as `ae8ae3e Add Phase 5 banking and
   reconciliation`; its allowed verification was `apps/web` `tsc --noEmit` clean, with full tests
   deferred under that phase's own code-first rule.
2. **Receipt status is derived from inventory movements.** `PurchaseOrder.recordReceipt()` no longer
   accepts an independent receipt-status flip. It records `PURCHASE_RECEIPT` stock movements for
   tracked PO lines, then derives `NOT_RECEIVED` / `PARTIALLY_RECEIVED` / `RECEIVED` from movements.
3. **Adjustment approval follows the Phase 3 Expense interpretation.** There is no org-setting
   toggle for V1. Users with `inventory.adjustments.post` can post a draft directly; explicit
   submit/approve remains available for segregated approval flows.
4. **Valuation methods are conservative.** The source docs name organization-selected supported
   valuation but do not enumerate labels in the extracted text; Phase 6 ships `FIFO` and
   `WEIGHTED_AVERAGE`, defaulting to `FIFO`.
5. **Reorder is advisory only.** Reorder suggestions never create purchase orders automatically.

## Milestone 6A - Inventory schema and migration

- [x] `Warehouse`, `StockMovement`, `InventoryAdjustment`, and `ValuationLayer` models added
- [x] Existing `Item` model extended with purchase account, purchase tax default, inventory-tracking
      flag, reorder threshold/quantity, and preferred vendor
- [x] Existing sales/purchase line models extended with optional `warehouseId` where tracked items
      can later post inventory movement
- [x] Organization preferences extended with `inventoryValuationMethod`
- [x] Migration created at `apps/api/prisma/migrations/20260826153000_add_phase6_inventory/`
- [x] Prisma schema validated and client regenerated

## Milestone 6B - Backend services and posting flows

- [x] Warehouses CRUD service and controller
- [x] Append-only stock movement history exposed as read-only API
- [x] Inventory adjustments create/edit/submit/approve/post/cancel flow
- [x] Inventory transfers create paired OUT/IN movements with net organization quantity unchanged
- [x] Purchase order receipt creates inbound valuation layers and stock movements for tracked items
- [x] Invoice issue consumes valuation layers and posts COGS via `LedgerService.postJournalFromLines`
- [x] Reorder advice endpoint based on tracked items below threshold
- [x] Inventory valuation endpoint aggregates remaining valuation layers by item and warehouse

## Milestone 6C - Permissions and contracts

- [x] `inventory.*` permission keys added to the API catalog
- [x] Read-only baseline receives inventory view keys
- [x] ADMIN and ACCOUNTANT receive full inventory access
- [x] `INVENTORY_MANAGER` receives real forward workflow permissions without approval authority
- [x] Contracts permission schema and group enum updated
- [x] Contract schemas, DTOs, response wrappers, and inferred types added for Phase 6 inventory

## Milestone 6D - Web inventory workspace

- [x] Items screen extended with inventory-tracking and reorder fields
- [x] Warehouses screen: list, create, edit, activate/deactivate
- [x] Stock Movements screen: append-only movement list with item/warehouse filters
- [x] Adjustments screen: list, create, submit, approve, post, cancel
- [x] Transfers screen: post tracked stock transfers between warehouses
- [x] Reorder screen: advisory replenishment list only
- [x] Inventory valuation report screen
- [x] Inventory nav group wired into `apps/web/src/components/app-shell.tsx`

## Milestone 6E - Compileability check

- [x] Run `tsc --noEmit` in `apps/api` and keep it clean
- [x] Run `tsc --noEmit` in `apps/web` and keep it clean

## Deferred verification pass

- [x] Cover build spec section 18.2 scenario 2 in `apps/api/test/inventory.int.test.ts`:
      purchase -> bill -> payment -> stock receipt -> sale/invoice -> stock issue/COGS ->
      customer payment -> inventory valuation agrees to GL
- [x] Add integration coverage proving stock-changing inventory workflows create traceable movements
- [x] Add integration coverage for partial and full PO receipts deriving receipt status from
      `PURCHASE_RECEIPT` movements
- [x] Add integration coverage for FIFO and weighted-average issue costing
- [x] Add integration coverage for adjustment posting and approval flow
- [x] Add integration coverage for transfer source/destination movement pairs
- [x] Extend the authorization-boundary matrix for all Phase 6 controllers
- [x] Run the unit and DB-backed integration test pass after the user lifts the code-first
      restriction
- [ ] Run lint, prettier, migration drift, and build checks when requested
