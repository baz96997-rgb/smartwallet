import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UserService } from '../user/user.service';
import { WhatsAppService } from './whatsapp.service';

@Injectable()
export class TrialScheduler {
  private readonly logger = new Logger(TrialScheduler.name);
  constructor(private userService: UserService, private waService: WhatsAppService) {}
  @Cron(CronExpression.EVERY_HOUR)
  async checkExpiredTrials() {
    const users = await this.userService.getExpiredUnreminded();
    for (const user of users) {
      try { await this.waService.sendExpiryReminder(user); } catch(e) {}
    }
  }
}
