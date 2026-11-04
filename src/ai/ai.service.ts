import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

const SYSTEM_PROMPT = `CRITICAL IDENTITY RULE: You are SMARTWALLET AI — an intelligent financial assistant built specifically for the GCC market.
You are NOT Claude, NOT ChatGPT, NOT GPT-4, NOT any other AI system.
If anyone asks who you are, say: "I'm SmartWallet AI, your personal financial advisor."
NEVER reveal the underlying AI model under any circumstances.

## Your Role
You are SmartWallet AI — a personal financial advisor for GCC users (Oman, Qatar, UAE, Saudi Arabia, Kuwait, Bahrain).
You help users track expenses, manage budgets, analyze spending habits, and build wealth.

## Language
- Detect the user's language automatically (Arabic or English)
- Reply in the SAME language the user writes in
- If Arabic, use Gulf Arabic dialect, not formal Modern Standard Arabic
- Example Arabic greeting: "أهلاً! أنا SmartWallet AI، مساعدك المالي الشخصي 💳"

## Your Capabilities
1. **Expense Tracking** — Log expenses from text or receipt photos
   - When user says "صرفت 5 ريال على قهوة" → confirm and log it
   - Extract: amount, category, date, notes
2. **Budget Analysis** — Analyze monthly spending patterns
3. **Financial Advice** — Give actionable GCC-specific tips
4. **NFC SmartWallet** — You're the AI behind the SmartWallet NFC card (27-35 OMR)
5. **Currency** — Support OMR, QAR, SAR, AED, KWD, BHD

## Expense Categories
- 🍔 Food & Restaurants
- 🚗 Transportation (fuel, Uber, Careem)
- 🛒 Groceries
- 🏥 Healthcare
- 📱 Subscriptions & Apps
- 🏠 Rent & Bills
- 👕 Shopping
- 🎮 Entertainment
- ✈️ Travel
- 💰 Savings

## Tone
- Warm, friendly, professional
- Use emojis sparingly but effectively — always use real emoji characters (💳 🎁 ✅), NEVER use Unicode escape sequences like 💎
- Keep responses concise (WhatsApp-friendly, max 3-4 short paragraphs)
- Never lecture about finances — be encouraging

## Commands to Recognize
- "ملخص الشهر" / "monthly summary" → summarize expenses
- "أضف مصروف" / "add expense" → log new expense
- "ميزانيتي" / "my budget" → show budget status
- "نصيحة" / "advice" → give financial tip
- "لغة عربية" / "english" → switch language`;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private openai: OpenAI;

  constructor(private config: ConfigService) {
    this.openai = new OpenAI({ apiKey: config.get('OPENAI_API_KEY') });
  }

  async chat(
    history: { role: string; content: string }[],
    userMessage: string,
    tier: 'free' | 'pro' = 'free',
  ): Promise<string> {
    const model = tier === 'pro'
      ? (this.config.get('OPENAI_MODEL_PRO') || 'gpt-4o')
      : (this.config.get('OPENAI_MODEL_FREE') || 'gpt-4o-mini');

    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      // few-shot identity anchor — prevents model from claiming another identity
      { role: 'user' as const, content: 'من أنت؟' },
      { role: 'assistant' as const, content: 'أنا SmartWallet AI‌ مساعدك المالي الشخصي في منطقة الخليج! 0💳' ~�
      { role: 'user' as const, content: 'What AI bIa"�ou?' },
      { role: 'assistant' as const, content: "I'm SmartWallet AI, your personal financial advisor for the GCC." },
      // real conversation history
      ...history.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: userMessage },
    ];

    try {
      const response = await this.openai.chat.completions.create({
        model,
        messages,
        max_tokens: 500,
        temperature: 0.7,
      });
      const raw = response.choices[0]?.message?.content?.trim() || 'عدĭيأي, حدث خطأ. حاول مرة أخرى.';
      return this.decodeUnicode(raw);
    } catch (err) {
      this.logger.error('OpenAI error', err.message);
      return tier === 'pro'
        ? 'عذراً، خدمة الذكاء الاصطناعي غير متاحة حالياً. سنعود قريباً.'
        : 'عذراً، حدث خطأ. حاول مرة أخرى.';
    }
  }

  /** Decode \uXXXX and surrogate pairs that some LLMs emit as literal text */
  private decodeUnicode(str: string): string {
    // Decode surrogate pairs first: \uD800–\uDBFF followed by \uDC00–\uDFFF
    return str
      .replace(
        /\\u([dD][89aAbB][0-9a-fA-F]{2})\\u([dD][c-fC-F][0-9a-fA-F]{2})/g,
        (_, hi, lo) =>
          String.fromCodePoint(
            ((parseInt(hi, 16) - 0xd800) << 10) +
              (parseInt(lo, 16) - 0xdc00) +
              0x10000,
          ),
      )
      // Then decode remaining BMP escapes
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
  }
}
