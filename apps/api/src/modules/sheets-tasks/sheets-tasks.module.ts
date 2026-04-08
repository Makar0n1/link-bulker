import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SheetsTasksController } from './sheets-tasks.controller';
import { SheetsTasksService } from './sheets-tasks.service';

@Module({
  imports: [AuthModule],
  controllers: [SheetsTasksController],
  providers: [SheetsTasksService],
  exports: [SheetsTasksService],
})
export class SheetsTasksModule {}
