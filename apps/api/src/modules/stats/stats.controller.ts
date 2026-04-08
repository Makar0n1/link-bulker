import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ProjectStatsQuery, type SessionUser } from '@link-checker/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionGuard } from '../auth/session.guard';
import { StatsService } from './stats.service';

@Controller('projects')
@UseGuards(SessionGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /**
   * GET /api/v1/projects/:id/stats?source=manual|sheets|all
   *
   * Returns aggregated analytics for the project. The same response shape
   * is used for all three scopes; the frontend keeps three separate
   * TanStack Query caches keyed by `(projectId, source)`.
   */
  @Get(':id/stats')
  get(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(ProjectStatsQuery)) query: ProjectStatsQuery,
  ) {
    return this.stats.forProject(user.id, id, query.source);
  }
}
