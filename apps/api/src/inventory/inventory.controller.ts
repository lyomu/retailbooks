import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AuthService } from '../auth/auth.service.js';
import { requestMetadata } from '../auth/request-context.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  RequirePermission,
  type OrganizationRequest,
} from '../organizations/organization-context.js';
import { OrganizationGuard } from '../organizations/organization.guard.js';
import {
  CreateInventoryAdjustmentDto,
  CreateInventoryTransferDto,
  CreateWarehouseDto,
  ListInventoryAdjustmentsQueryDto,
  ListStockMovementsQueryDto,
  UpdateInventoryAdjustmentDto,
  UpdateWarehouseDto,
} from './inventory.dto.js';
import { InventoryService } from './inventory.service.js';

@Controller('organizations/:organizationId/inventory')
@UseGuards(SessionGuard, OrganizationGuard)
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly auth: AuthService,
  ) {}

  @Get('warehouses')
  @RequirePermission('inventory.warehouses.view')
  async warehouses(@Req() request: OrganizationRequest) {
    return { data: await this.inventory.listWarehouses(request.organization.id) };
  }

  @Post('warehouses')
  @HttpCode(201)
  @RequirePermission('inventory.warehouses.manage')
  async createWarehouse(@Body() input: CreateWarehouseDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.inventory.createWarehouse(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Patch('warehouses/:warehouseId')
  @RequirePermission('inventory.warehouses.manage')
  async updateWarehouse(
    @Param('warehouseId', new ParseUUIDPipe()) warehouseId: string,
    @Body() input: UpdateWarehouseDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.inventory.updateWarehouse(
        request.organization,
        request.auth.user,
        warehouseId,
        input,
        metadata,
      ),
    };
  }

  @Get('movements')
  @RequirePermission('inventory.movements.view')
  async movements(@Query() query: ListStockMovementsQueryDto, @Req() request: OrganizationRequest) {
    return {
      data: await this.inventory.listMovements(
        request.organization.id,
        query.itemId,
        query.warehouseId,
      ),
    };
  }

  @Get('adjustments')
  @RequirePermission('inventory.adjustments.view')
  async adjustments(
    @Query() query: ListInventoryAdjustmentsQueryDto,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.inventory.listAdjustments(request.organization.id, query.status) };
  }

  @Post('adjustments')
  @HttpCode(201)
  @RequirePermission('inventory.adjustments.manage')
  async createAdjustment(
    @Body() input: CreateInventoryAdjustmentDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.inventory.createAdjustment(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Patch('adjustments/:adjustmentId')
  @RequirePermission('inventory.adjustments.manage')
  async updateAdjustment(
    @Param('adjustmentId', new ParseUUIDPipe()) adjustmentId: string,
    @Body() input: UpdateInventoryAdjustmentDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.inventory.updateAdjustment(
        request.organization,
        request.auth.user,
        adjustmentId,
        input,
        metadata,
      ),
    };
  }

  @Post('adjustments/:adjustmentId/submit')
  @HttpCode(200)
  @RequirePermission('inventory.adjustments.manage')
  async submitAdjustment(
    @Param('adjustmentId', new ParseUUIDPipe()) adjustmentId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.inventory.submitAdjustment(
        request.organization,
        request.auth.user,
        adjustmentId,
        metadata,
      ),
    };
  }

  @Post('adjustments/:adjustmentId/approve')
  @HttpCode(200)
  @RequirePermission('inventory.adjustments.approve')
  async approveAdjustment(
    @Param('adjustmentId', new ParseUUIDPipe()) adjustmentId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.inventory.approveAdjustment(
        request.organization,
        request.auth.user,
        adjustmentId,
        metadata,
      ),
    };
  }

  @Post('adjustments/:adjustmentId/post')
  @HttpCode(200)
  @RequirePermission('inventory.adjustments.post')
  async postAdjustment(
    @Param('adjustmentId', new ParseUUIDPipe()) adjustmentId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.inventory.postAdjustment(
        request.organization,
        request.auth.user,
        adjustmentId,
        metadata,
      ),
    };
  }

  @Post('adjustments/:adjustmentId/cancel')
  @HttpCode(200)
  @RequirePermission('inventory.adjustments.manage')
  async cancelAdjustment(
    @Param('adjustmentId', new ParseUUIDPipe()) adjustmentId: string,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.inventory.cancelAdjustment(
        request.organization,
        request.auth.user,
        adjustmentId,
        metadata,
      ),
    };
  }

  @Post('transfers')
  @HttpCode(201)
  @RequirePermission('inventory.transfers.manage')
  async transfer(@Body() input: CreateInventoryTransferDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.inventory.transferStock(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Get('reorder')
  @RequirePermission('inventory.reorder.view')
  async reorder(@Req() request: OrganizationRequest) {
    return { data: await this.inventory.reorderAdvice(request.organization.id) };
  }

  @Get('valuation')
  @RequirePermission('inventory.valuation.view')
  async valuation(@Req() request: OrganizationRequest) {
    return { data: await this.inventory.valuationReport(request.organization.id) };
  }
}
