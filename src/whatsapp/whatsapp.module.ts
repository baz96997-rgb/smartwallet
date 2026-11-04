import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { TrialScheduler } from './trial.scheduler';
import { AiModule } from '../ai/ai.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [ScheduleModule.forRoot(), AiModule, UserModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, TrialScheduler],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
