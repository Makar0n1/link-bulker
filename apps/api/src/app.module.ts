import { Module } from '@nestjs/common';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { QueueClientModule } from './modules/queue-client/queue-client.module';
import { LinksModule } from './modules/links/links.module';
import { SheetsTasksModule } from './modules/sheets-tasks/sheets-tasks.module';
import { StatsModule } from './modules/stats/stats.module';
import { StreamModule } from './modules/stream/stream.module';

@Module({
  imports: [
    PrismaModule,
    QueueClientModule,
    AuthModule,
    ProjectsModule,
    LinksModule,
    SheetsTasksModule,
    StatsModule,
    StreamModule,
    HealthModule,
  ],
})
export class AppModule {}
