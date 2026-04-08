import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  CreateProjectInput,
  UpdateProjectInput,
  type SessionUser,
} from '@link-checker/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionGuard } from '../auth/session.guard';
import { ProjectsService } from './projects.service';

@Controller('projects')
@UseGuards(SessionGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.projects.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(CreateProjectInput)) dto: CreateProjectInput,
  ) {
    return this.projects.create(user.id, dto);
  }

  @Get(':id')
  getById(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.projects.getById(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProjectInput)) dto: UpdateProjectInput,
  ) {
    return this.projects.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.projects.remove(user.id, id);
  }
}
