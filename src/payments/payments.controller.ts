import {
  Controller, Post, Get, Body, Param, Query, Res, Logger, HttpCode,
} from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { UserService } from '../user/user.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

const SUBSCRIPTION_AMOUNT = 2; // OMR per month

@Controller('api/payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly payments: PaymentsService,
    private readonly users: UserService,
    private readonly wa: WhatsAppService,
    private readonly config: ConfigService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/payments/subscribe/:phone
  // WhatsApp bot sends this link → customer clicks → goes to AmwalPay
  // ─────────────────────────────────────────────────────────────────────
  @Get('subscribe/:phone')
  async startSubscription(
    @Param('phone') phone: string,
    @Res() res: Response,
  ) {
    const backendUrl = this.config.get<string>(
      'BACKEND_URL',
      'https://smartwallet-backend-qv11.onrender.com',
    );
    const result = await this.payments.initializePayment(
      phone,
      SUBSCRIPTION_AMOUNT,
      `${backendUrl}/api/payments/callback?phone=${phone}`,
      `${backendUrl}/api/payments/cancel?phone=${phone}`,
    );

    if (result.success && result.paymentUrl) {
      return res.redirect(302, result.paymentUrl);
    }
    return res.status(500).json({ error: result.error });
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/payments/callback?phone=&isSuccess=&...
  // AmwalPay redirects here after payment (returnUrl)
  // Also saves customerId + tokenId for future recurring charges
  // ─────────────────────────────────────────────────────────────────────
  @Get('callback')
  async paymentCallback(@Query() query: Record<string, string>, @Res() res: Response) {
    const { phone, isSuccess, customerId, customerTokenId, responseCode } = query;

    this.logger.log(`Payment callback: phone=${phone} success=${isSuccess} code=${responseCode}`);

    if (isSuccess !== 'true' || responseCode !== '00') {
      // Verify hash before trusting result
      if (!this.payments.verifyHash(query as any)) {
        this.logger.warn('Invalid hash on callback — ignoring');
        return res.redirect('https://aismartwallet.netlify.app/?payment=failed');
      }
      return res.redirect('https://aismartwallet.netlify.app/?payment=cancelled');
    }

    // Verify HMAC signature
    if (!this.payments.verifyHash(query as any)) {
      this.logger.warn('Invalid hash on success callback — ignoring');
      return res.redirect('https://aismartwallet.netlify.app/?payment=failed');
    }

    const user = await this.users.findByPhone(phone);
    if (!user) {
      this.logger.warn(`Callback: no user found for phone ${phone}`);
      return res.redirect('https://aismartwallet.netlify.app/?payment=failed');
    }

    await this.users.activateSubscription(user.id, customerId || '', customerTokenId || '');

    // Send WhatsApp confirmation
    try {
      await this.wa.sendMessage(
        phone,
        '✅ تم تفعيل اشتراكك في SmartWallet بنجاح!\n\n' +
        'اشتراكك الشهري فعّال لمدة 30 يوماً. يمكنك الآن استخدام البوت بدون قيود. 🎉\n\n' +
        'قيو استفسار تواصل معنا على هذا الرقم.',
      );
    } catch (e) {
      this.logger.warn('Could not send WA confirmation: ' + e);
    }

    return res.redirect('https://aismartwallet.netlify.app/?payment=success');
  }

  // ─────────────────────────────────────────────────────────────────────
  // GET /api/payments/cancel?phone=
  // Customer cancelled payment
  // ─────────────────────────────────────────────────────────────────────
  @Get('cancel')
  async paymentCancel(@Query('phone') phone: string, @Res() res: Response) {
    this.logger.log(`Payment cancelled by ${phone}`);
    return res.redirect('https://aismartwallet.netlify.app/?payment=cancelled');
  }

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/payments/amwal/webhook
  // AmwalPay Cloud Notification — server-to-server push
  // Set this URL in AmwalPay portal → Merchant Integration → Cloud notification URL
  // ─────────────────────────────────────────────────────────────────────
  @Post('amwal/webhook')
  @HttpCode(200)
  async amwalWebhook(@Body() body: Record<string, any>) {
    this.logger.log(`AmwalPay webhook received: ${JSON.stringify(body)}`);

    // Verify signature
    if (!this.payments.verifyHash(body)) {
      this.logger.warn('AmwalPay webhook: invalid hash — rejected');
      return { ok: false, reason: 'invalid_hash' };
    }

    const { isSuccess, responseCode, merchantCustomerId, customerId, customerTokenId } = body;

    if (isSuccess !== true && isSuccess !== 'true') {
      this.logger.log('Webhook: payment not successful, skipping');
      return { ok: true };
    }
    if (responseCode !== '00') {
      this.logger.log(`Webhook: responseCode ${responseCode}, skipping`);
      return { ok: true };
    }

    // merchantCustomerId holds the phone number (set during InitializePayment)
    const phone = merchantCustomerId as string;
    if (!phone) {
      this.logger.warn('Webhook: no merchantCustomerId in payload');
      return { ok: false, reason: 'no_phone' };
    }

    const user = await this.users.findByPhone(phone);
    if (!user) {
      this.logger.warn(`Webhook: no user for phone ${phone}`);
      return { ok: false, reason: 'user_not_found' };
    }

    const expiry = await this.users.activateSubscription(
      user.id,
      customerId || user.amwalCustomerId || '',
      customerTokenId || user.amwalTokenId || '',
    );

    this.logger.log(`Subscription activated via webhook for ${phone} until ${expiry.toISOString()}`);

    // Send WhatsApp confirmation
    try {
      await this.wa.sendMessage(
        phone,
        '✅ تم تفعيل اشتراكك في SmartWallet بنجاح!\n\n' +
        `اشتراكك فعّال حتى: ${expiry.toLocaleDateString('ar-OM')}\n\n` +
        'يمكنك الآن استخدام البوت بدون قيود. 🎉',
      );
    } catch (e) {
      this.logger.warn('Could not send WA confirmation: ' + e);
    }

    return { ok: true };
  }

  // ─────────────────────────────────────────────────────────────────────
  // POST /api/payments/renew/:phone
  // Manually trigger Pay by Token for an existing subscriber
  // (called by a cron job or admin)
  // ─────────────────────────────────────────────────────────────────────
  @Post('renew/:phone')
  @HttpCode(200)
  async renewSubscription(@Param('phone') phone: string, @Res() res: Response) {
    const user = await this.users.findByPhone(phone);
    if (!user || !user.amwalCustomerId || !user.amwalTokenId) {
      return res.status(404).json({ error: 'User not found or no saved token' });
    }

    const result = await this.payments.payByToken(
      user.amwalCustomerId,
      user.amwalTokenId,
      SUBSCRIPTION_AMOUNT,
      user.email || undefined,
    );

    if (result.success) {
      const expiry = await this.users.activateSubscription(
        user.id,
        user.amwalCustomerId,
        user.amwalTokenId,
      );
      try {
        await this.wa.sendMessage(
          phone,
          '✅ تم تجديد اشتظرقطيةي SmartWallet بنجاح!\n\n' +
          `اشتظرقطية فعّال حتى: ${expiry.toLocaleDateString('ar-OM')} 🎉`,
        );
      } catch (e) { /* non-critical */ }
      return res.json({ ok: true, expiresAt: expiry });
    }

    return res.status(402).json({ ok: false, error: result.error });
  }
}
