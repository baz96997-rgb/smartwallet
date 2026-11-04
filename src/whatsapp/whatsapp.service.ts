import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AiService } from '../ai/ai.service';
import { UserService } from '../user/user.service';
import { User } from '../user/user.entity';

const WEBSITE_URL = 'https://smartwalletgcc.netlify.app';
const SUBSCRIBE_URL = `${WEBSITE_URL}/#pricing`;

// Simple email regex
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private processingLocks = new Map<string, boolean>();

  constructor(
    private config: ConfigService,
    private aiService: AiService,
    private userService: UserService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  //  MAIN ENTRY — called for every incoming message
  // ─────────────────────────────────────────────────────────────
  async handleMessage(message: any, contact: any) {
    const phone = message.from;

    if (this.processingLocks.get(phone)) {
      this.logger.warn(`Duplicate from ${phone} — skipped`);
      return;
    }
    this.processingLocks.set(phone, true);

    try {
      let user = await this.userService.findOrCreate(phone);

      // Save WhatsApp profile name on first contact
      if (contact?.profile?.name && !user.name) {
        await this.userService.saveName(user.id, contact.profile.name);
        user.name = contact.profile.name;
      }

      await this.userService.updateLastMessage(user.id);

      const text = message.type === 'text' ? (message.text?.body || '').trim() : '';

      // ── Route by onboarding state ──
      switch (user.onboardingState) {
        case 'new':
          return await this.handleNew(user, text);
        case 'asked_name':
          return await this.handleGotName(user, text);
        case 'asked_email':
          return await this.handleGotEmail(user, text);
        case 'active':
          return await this.handleActive(user, message, text);
        case 'expired':
          return await this.handleExpired(user);
        case 'subscribed':
          return await this.handleActive(user, message, text);
        default:
          return await this.handleNew(user, text);
      }
    } finally {
      this.processingLocks.delete(phone);
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  STATE: new — first ever message
  // ─────────────────────────────────────────────────────────────
  private async handleNew(user: User, text: string) {
    // If WhatsApp already gave us the name, skip asking
    if (user.name) {
      await this.userService.updateState(user.id, 'asked_email');
      await this.sendMessage(user.whatsappPhone,
        `أهلاً ${user.name}! 👋\n\nأنا *SmartWallet AI* — مساعدك المالي الشخصي لمنطقة الخليج 🌟\n\nيسعدني إعطائك *تجربة مجانية لمدة يومين كاملين* 🎁\n\nلتفعيل التجربة، أرسل لي *بريدك الإلكتروني* 📧`
      );
    } else {
      await this.userService.updateState(user.id, 'asked_name');
      await this.sendMessage(user.whatsappPhone,
        `أهلاً بك! 👋\n\nأنا *SmartWallet AI* — مساعدك المالي الشخصي لمنطقة الخليج 💳\n\nيسعدني إعطائك *تجربة مجانية لمدة يومين كاملين* 🎁\n\nما اسمك الكريم؟ 😊`
      );
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  STATE: asked_name
  // ─────────────────────────────────────────────────────────────
  private async handleGotName(user: User, text: string) {
    if (!text || text.length < 2) {
      return await this.sendMessage(user.whatsappPhone, 'يرجى إرسال اسمك 😊');
    }
    const name = text.split('\n')[0].substring(0, 40);
    await this.userService.saveName(user.id, name);
    await this.userService.updateState(user.id, 'asked_email');
    await this.sendMessage(user.whatsappPhone,
      `أهلاً ${name}! 🌟\n\nلتفعيل التجربة المجانية ليومين، أرسل لي *بريدك الإلكتروني* 📧\n\n_(سنستخدمه فقط لإرسال تقاريرك المالية الشهرية)_`
    );
  }

  // ─────────────────────────────────────────────────────────────
  //  STATE: asked_email
  // ─────────────────────────────────────────────────────────────
  private async handleGotEmail(user: User, text: string) {
    const match = text.match(EMAIL_RE);
    if (!match) {
      return await this.sendMessage(user.whatsappPhone,
        '❌ البريد الإلكتروني غير صحيح. أرسله بهذا الشكل:\n*yourname@gmail.com*'
      );
    }
    const email = match[0].toLowerCase();
    await this.userService.saveEmail(user.id, email);
    const expiresAt = await this.userService.activateTrial(user.id);
    const expiryStr = expiresAt.toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'long' });
    const name = user.name || 'عزيزي';
    await this.sendMessage(user.whatsappPhone,
      `🎉 *تم تفعيل تجربتك المجانية!*\n\n` +
      `مرحباً ${name}، لديك الآن *يومان كاملان* لتجربة SmartWallet AI!\n\n` +
      `⏰ التجربة تنتهي: *${expiryStr}*\n` +
      `📧 تم حفظ بريدك: ${email}\n\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `🚀 *جرّب الآن:*\n` +
      `• أخبرني بأي مصروف: _"صرفت 5 رىال على قهوة"_\n` +
      `• اطلب ملخص: _"ملخص اليوم"_\n` +
      `• اطلب نصيحة: _"نصيحة مالية"_\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `💳 هل تملك محفظة SmartWallet؟ اطلبها من هنا:\n${WEBSITE_URL}`
    );
  }

  // ─────────────────────────────────────────────────────────────
  //  STATE: active — trial or subscribed user chatting
  // ─────────────────────────────────────────────────────────────
  private async handleActive(user: User, message: any, text: string) {
    // Check trial validity
    const hasAccess = await this.userService.hasAccess(user);
    if (!hasAccess) {
      return await this.handleExpired(user);
    }

    // Re-fetch user after potential state update
    user = await this.userService.findOrCreate(user.whatsappPhone);

    let userText = text;
    if (message.type === 'image') {
      userText = await this.handleImage(message);
    } else if (message.type === 'audio') {
      userText = '[رسالة صوتية — يرجى الكتابة حالياً]';
    } else if (!text) {
      return await this.sendMessage(user.whatsappPhone, 'أرسل رسالة نصية أو صورة فاتورة 📄');
    }

    await this.userService.saveMessage(user.id, 'user', userText, message.type || 'text');

    const history = await this.userService.getHistory(user.id, 18);
    const historyWithoutLast = history.slice(0, -1);

    // Add trial context to system if still in trial
    let extra = '';
    if (user.tier !== 'pro' && !user.trialExpired) {
      const hrs = this.userService.trialHoursLeft(user);
      if (hrs < 6) {
        extra = `\n\n⏰ تبقى ${hrs} ساعة فقط في تجربتك المجانية. للاستمرار: ${SUBSCRIBE_URL}`;
      }
    }

    const reply = await this.aiService.chat(historyWithoutLast, userText, user.tier as 'free' | 'pro') + extra;
    await this.userService.saveMessage(user.id, 'assistant', reply);
    await this.sendMessage(user.whatsappPhone, reply);
  }

  // ─────────────────────────────────────────────────────────────
  //  STATE: expired — trial ended
  // ─────────────────────────────────────────────────────────────
  async handleExpired(user: User) {
    const name = user.name || '';
    await this.sendMessage(user.whatsappPhone,
      `⏰ *انتهت فترة تجربتك المجانية*\n\n` +
      `${name ? `شكراً ${name} على تجربة SmartWallet AI! 🙏\n\n` : ''}` +
      `استمر في تتبع مصاريفك وبماء ثروتك بالاشتراك:\n\n` +
      `💳 *المحفظة الذكية* — شراء لمرة واحدة: 27-35 ر.ع\n` +
      `🤖 *اشتراك الوكيل المالي* — *1.5 ر.ع/شهر* فقط\n` +
      `🎁 أو سنوي بـ 15 ر.ع (شهران مجاناً!)\n\n` +
      `🔗 اشترك الآن:\n${SUBSCRIBE_URL}\n\n` +
      `أو تواصل معنا مباشرة وسنساعدك 💬`
    );
  }

  // ─────────────────────────────────────────────────────────────
  //  PROACTIVE: send expiry reminder (called by scheduler)
  // ─────────────────────────────────────────────────────────────
  async sendExpiryReminder(user: User) {
    const name = user.name || '';
    await this.sendMessage(user.whatsappPhone,
      `مرحباً ${name}! ⏰\n\n` +
      `تجربتك المجانية مع *SmartWallet AI* انتهت.\n\n` +
      `لا تفوّت الفرصة — اشترك الآن بـ *1.5 ر.ع/شهر* فقط:\n` +
      `🔗 ${SUBSCRIBE_URL}\n\n` +
      `نحن هنا إذا احتجت أي مساعدة 💙`
    );
    await this.userService.markReminderSent(user.id);
  }

  // ─────────────────────────────────────────────────────────────
  //  HELPERS
  // ─────────────────────────────────────────────────────────────
  private async handleImage(message: any): Promise<string> {
    try {
      const mediaId = message.image?.id;
      if (!mediaId) return '[صورة غير صالحة]';
      const token = this.config.get('WHATSAPP_ACCESS_TOKEN');
      const mediaRes = await axios.get(
        `https://graph.facebook.com/v18.0/${mediaId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const mediaUrl = mediaRes.data?.url;
      if (!mediaUrl) return '[لم أتمكن من قراءة الصورة]';
      return `[صورة فاتورة: ${message.image?.caption || 'وصل/فاتورة'}]`;
    } catch (err) {
      this.logger.error('Image error', err.message);
      return '⚠️ لم أتمكن من قراءة الصورة، اكتب المبلغ يدوياً';
    }
  }

  async sendMessage(to: string, text: string): Promise<void> {
    const token = this.config.get('WHATSAPP_ACCESS_TOKEN');
    const phoneNumberId = this.config.get('WHATSAPP_PHONE_NUMBER_ID');
    try {
      await axios.post(
        `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { body: text, preview_url: false },
        },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
      );
    } catch (err) {
      this.logger.error(`Send failed to ${to}`, err.response?.data || err.message);
    }
  }
}
