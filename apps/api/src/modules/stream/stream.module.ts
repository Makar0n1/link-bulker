import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StreamController } from './stream.controller';

@Module({
  imports: [AuthModule],
  controllers: [StreamController],
})
export class StreamModule {}
