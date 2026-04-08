import { Controller, Get, HttpCode, HttpException, HttpStatus } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @HttpCode(200)
  ping() {
    return { status: 'ok', uptimeSec: Math.floor(process.uptime()) };
  }

  @Get('deep')
  async deep() {
    const result = await this.health.deep();
    if (result.status !== 'ok') {
      throw new HttpException(result, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}
