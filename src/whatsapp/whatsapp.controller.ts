import { Controller, Get, Post, Query, Body, Res, Logger } from '@nestjs/common';
import { Response } from 'express';
import { WhatsAppService } from './whatsapp.service';
import { ConfigService } from '@nestjs/config';

@Controller('webhook')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);
  constructor(private readonly waService: WhatsAppService, private readonly config: ConfigService) {}
  @Get('whatsapp')
  verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    const verifyToken = this.config.get('WHATSAPP_VERIFY_TOKEN');
    if (mode === 'subscribe' && token === verifyToken) { return res.status(200).send(challenge); }
    return res.status(403).send('Forbidden');
  }
  @Post('whatsapp')
  async receive(@Body() body: any, @Res() res: Response) {
    res.status(200).send('EVENT_RECEIVED');
    try {
      const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages;
      if (!messages?.length) return;
      const value = body?.entry?.[0]?.changes?.[0]?.value;
      for (const message of messages) { await this.waService.handleMessage(message, value?.contacts?.[0]); }
    } catch(err) { this.logger.error('Webhook error', err.message); }
  }
}
