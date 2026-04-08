import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CreateManualLinksInput,
  ListLinksQuery,
  type SessionUser,
} from '@link-checker/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionGuard } from '../auth/session.guard';
import { LinksService } from './links.service';

@Controller()
@UseGuards(SessionGuard)
export class LinksController {
  constructor(private readonly links: LinksService) {}

  @Get('projects/:projectId/links')
  list(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Query(new ZodValidationPipe(ListLinksQuery)) query: ListLinksQuery,
  ) {
    return this.links.list(user.id, projectId, query);
  }

  @Post('projects/:projectId/links/manual')
  createManual(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(CreateManualLinksInput)) dto: CreateManualLinksInput,
  ) {
    return this.links.createManualLinks(user.id, projectId, dto);
  }

  @Delete('projects/:projectId/links')
  deleteAll(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ) {
    return this.links.deleteAllManual(user.id, projectId);
  }

  @Delete('links/:linkId')
  deleteOne(@CurrentUser() user: SessionUser, @Param('linkId') linkId: string) {
    return this.links.deleteOne(user.id, linkId);
  }

  @Post('projects/:projectId/check')
  startCheck(
    @CurrentUser() user: SessionUser,
    @Param('projectId') projectId: string,
  ) {
    return this.links.startManualCheck(user.id, projectId);
  }

  @Post('links/:linkId/check')
  recheckOne(@CurrentUser() user: SessionUser, @Param('linkId') linkId: string) {
    return this.links.recheckOne(user.id, linkId);
  }
}
