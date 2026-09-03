import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
  ChangeProjectStatusDto,
  CreateProjectDto,
  CreateProjectTaskDto,
  CreateTimeEntryDto,
  GenerateProjectInvoiceDto,
  LinkProjectExpenseDto,
  ProjectQueryDto,
  TimeDecisionDto,
  TimeEntryQueryDto,
  UpdateProjectDto,
  UpdateProjectExpenseDto,
  UpdateProjectTaskDto,
  UpdateTimeEntryDto,
  UpsertProjectBudgetDto,
} from './projects.dto.js';
import { ProjectsService } from './projects.service.js';

@Controller('organizations/:organizationId/projects')
@UseGuards(SessionGuard, OrganizationGuard)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly auth: AuthService,
  ) {}

  // --- time lives above `:projectId` so its literal segment is not captured as a project id ------

  @Get('time-entries')
  @RequirePermission('projects.time.view')
  async timeEntries(@Query() query: TimeEntryQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.projects.listTimeEntries(request.organization.id, query) };
  }

  @Post('time-entries')
  @HttpCode(201)
  @RequirePermission('projects.time.manage')
  async createTimeEntry(@Body() input: CreateTimeEntryDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.projects.createTimeEntry(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Patch('time-entries/:timeEntryId')
  @RequirePermission('projects.time.manage')
  async updateTimeEntry(
    @Param('timeEntryId', new ParseUUIDPipe()) timeEntryId: string,
    @Body() input: UpdateTimeEntryDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.projects.updateTimeEntry(
        request.organization,
        request.auth.user,
        timeEntryId,
        input,
        metadata,
      ),
    };
  }

  @Delete('time-entries/:timeEntryId')
  @HttpCode(204)
  @RequirePermission('projects.time.manage')
  async deleteTimeEntry(
    @Param('timeEntryId', new ParseUUIDPipe()) timeEntryId: string,
    @Req() request: OrganizationRequest,
  ) {
    await this.projects.deleteTimeEntry(request.organization, request.auth.user, timeEntryId);
  }

  @Post('time-entries/submit')
  @RequirePermission('projects.time.manage')
  async submitTime(@Body() input: TimeDecisionDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.projects.submitTime(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Post('time-entries/approve')
  @RequirePermission('projects.time.approve')
  async approveTime(@Body() input: TimeDecisionDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.projects.approveTime(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Post('time-entries/reject')
  @RequirePermission('projects.time.approve')
  async rejectTime(@Body() input: TimeDecisionDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.projects.rejectTime(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Post('time-entries/unlock')
  @RequirePermission('projects.time.approve')
  async unlockTime(@Body() input: TimeDecisionDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.projects.unlockTime(
        request.organization,
        request.auth.user,
        input,
        metadata,
      ),
    };
  }

  @Patch('expenses/:projectExpenseId')
  @RequirePermission('projects.expenses.manage')
  async updateProjectExpense(
    @Param('projectExpenseId', new ParseUUIDPipe()) projectExpenseId: string,
    @Body() input: UpdateProjectExpenseDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.projects.updateProjectExpense(
        request.organization,
        request.auth.user,
        projectExpenseId,
        input,
        metadata,
      ),
    };
  }

  @Delete('expenses/:projectExpenseId')
  @HttpCode(204)
  @RequirePermission('projects.expenses.manage')
  async unlinkExpense(
    @Param('projectExpenseId', new ParseUUIDPipe()) projectExpenseId: string,
    @Req() request: OrganizationRequest,
  ) {
    await this.projects.unlinkExpense(request.organization, request.auth.user, projectExpenseId);
  }

  @Patch('tasks/:taskId')
  @RequirePermission('projects.manage')
  async updateTask(
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() input: UpdateProjectTaskDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.projects.updateTask(
        request.organization,
        request.auth.user,
        taskId,
        input,
        metadata,
      ),
    };
  }

  // --- projects ---------------------------------------------------------------------------------

  @Get()
  @RequirePermission('projects.view')
  async list(@Query() query: ProjectQueryDto, @Req() request: OrganizationRequest) {
    return { data: await this.projects.list(request.organization.id, query.status) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('projects.manage')
  async create(@Body() input: CreateProjectDto, @Req() request: OrganizationRequest) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.projects.create(request.organization, request.auth.user, input, metadata),
    };
  }

  @Get(':projectId')
  @RequirePermission('projects.view')
  async detail(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.projects.detail(request.organization.id, projectId) };
  }

  @Patch(':projectId')
  @RequirePermission('projects.manage')
  async update(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() input: UpdateProjectDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.projects.update(
        request.organization,
        request.auth.user,
        projectId,
        input,
        metadata,
      ),
    };
  }

  @Post(':projectId/status')
  @RequirePermission('projects.manage')
  async changeStatus(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() input: ChangeProjectStatusDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.projects.changeStatus(
        request.organization,
        request.auth.user,
        projectId,
        input,
        metadata,
      ),
    };
  }

  @Get(':projectId/tasks')
  @RequirePermission('projects.view')
  async tasks(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.projects.listTasks(request.organization.id, projectId) };
  }

  @Post(':projectId/tasks')
  @HttpCode(201)
  @RequirePermission('projects.manage')
  async createTask(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() input: CreateProjectTaskDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.projects.createTask(
        request.organization,
        request.auth.user,
        projectId,
        input,
        metadata,
      ),
    };
  }

  @Get(':projectId/budgets')
  @RequirePermission('projects.view')
  async budgets(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.projects.listBudgets(request.organization.id, projectId) };
  }

  @Post(':projectId/budgets')
  @RequirePermission('projects.manage')
  async upsertBudget(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() input: UpsertProjectBudgetDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.projects.upsertBudget(
        request.organization,
        request.auth.user,
        projectId,
        input,
        metadata,
      ),
    };
  }

  @Get(':projectId/expenses')
  @RequirePermission('projects.view')
  async projectExpenses(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.projects.listProjectExpenses(request.organization.id, projectId) };
  }

  @Post(':projectId/expenses')
  @HttpCode(201)
  @RequirePermission('projects.expenses.manage')
  async linkExpense(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() input: LinkProjectExpenseDto,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.projects.linkExpense(
        request.organization,
        request.auth.user,
        projectId,
        input,
        metadata,
      ),
    };
  }

  @Get(':projectId/billables')
  @RequirePermission('projects.billing.manage')
  async billables(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.projects.listBillables(request.organization.id, projectId) };
  }

  @Post(':projectId/generate-invoice')
  @RequirePermission('projects.billing.manage')
  async generateInvoice(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() input: GenerateProjectInvoiceDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: OrganizationRequest,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    return {
      data: await this.projects.generateInvoice(
        request.organization,
        request.auth.user,
        projectId,
        input,
        metadata,
        idempotencyKey,
      ),
    };
  }

  @Get(':projectId/profitability')
  @RequirePermission('projects.profitability.view')
  async profitability(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Req() request: OrganizationRequest,
  ) {
    return { data: await this.projects.profitability(request.organization.id, projectId) };
  }
}
