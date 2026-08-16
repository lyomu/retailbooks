import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse } from '@retailbooks/contracts';

import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  liveness(): HealthResponse {
    return this.healthService.liveness();
  }

  @Get('ready')
  async readiness(): Promise<HealthResponse> {
    const response = await this.healthService.readiness();
    if (response.status === 'degraded') {
      throw new ServiceUnavailableException(response);
    }
    return response;
  }
}
