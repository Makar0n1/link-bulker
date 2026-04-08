import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CreateSheetsTaskInput,
  UpdateSheetsTaskInput,
  type SessionUser,
} from '@link-checker/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionGuard } from '../auth/session.guard';
import { SheetsTasksService } from './sheets-tasks.service';

@Controller()
@UseGuards(SessionGuard)
export class SheetsTasksController {
  constructor(private readonly service: SheetsTasksService) {}

  @Get('projects/:projectId/sheets-tasks')
  list(@CurrentUser() user: SessionUser, @Param('projectId') projectId: string) {
    return this.service.list(user.id, projectId);
  }

  @Post('projects/:projectId/sheets-tasks')
  create(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(CreateSheetsTaskInput)) dto: CreateSheetsTaskInput,
  ) {
    return this.service.create(user.id, projectId, dto);
  }

  @Patch('sheets-tasks/:taskId')
  update(
    @CurrentUser() user: SessionUser,
    @Param('taskId') taskId: string,
    @Body(new ZodValidationPipe(UpdateSheetsTaskInput)) dto: UpdateSheetsTaskInput,
  ) {
    return this.service.update(user.id, taskId, dto);
  }

  @Delete('sheets-tasks/:taskId')
  remove(@CurrentUser() user: SessionUser, @Param('taskId') taskId: string) {
    return this.service.remove(user.id, taskId);
  }

  @Post('sheets-tasks/:taskId/run')
  run(@CurrentUser() user: SessionUser, @Param('taskId') taskId: string) {
    return this.service.runNow(user.id, taskId);
  }

  /**
   * Public-ish: needs an authenticated session, but the email is the same
   * across all users. Used by the Add Sheets Task dialog so the user can
   * copy it and share their spreadsheet with that account.
   */
  @Get('sheets/service-account-email')
  serviceAccountEmail() {
    return this.service.getServiceAccountEmail();
  }
}
