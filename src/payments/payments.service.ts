import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as https from 'https';

export interface InitPaymentResult { success: boolean; paymentUrl?: string; error?: string; }

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly BASE_URL = 'https://webhook.amwalpg.com';
  private get merchantId() { return parseInt(this.config.get<string>('AMWALPAY_MERCHANT_ID', '0'), 10); }
  private get terminalId() { return parseInt(this.config.get<string>('AMWALPAY_TERMINAL_ID', '0'), 10); }
  private get secureKey() { return this.config.get<string>('AMWALPAY_SECURE_KEY', ''); }
  constructor(private readonly config: ConfigService) {}

  calcHash(obj: Record<string, any>): string {
    const sorted = Object.keys(obj).filter(k => k !== 'secureHashValue' && obj[k] != null).sort().reduce((acc: any, k) => { acc[k] = obj[k]; return acc; }, {});
    const payload = Object.entries(sorted).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join('&');
    return crypto.createHmac('sha256', Buffer.from(this.secureKey, 'hex')).update(payload, 'utf8').digest('hex').toUpperCase();
  }

  verifyHash(payload: Record<string, any>): boolean {
    const received = payload.secureHashValue as string;
    if (!received) return false;
    return received.toUpperCase() === this.calcHash(payload);
  }

  private post<T>(path: string, body: object): Promise<T> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const url = new URL(path, this.BASE_URL);
      const req = https.request({ hostname: url.hostname, port: 443, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { reject(new Error(raw)); } });
      });
      req.on('error', reject); req.write(data); req.end();
    });
  }

  async initializePayment(phone: string, amount: number, returnUrl: string, cancelUrl: string): Promise<InitPaymentResult> {
    const body: any = { merchantId: this.merchantId, terminalId: this.terminalId, amount, currency: 512, language: 1, merchantReference: `SW_${phone}_${Date.now()}`, requestDateTime: new Date().toISOString(), returnUrl, cancelUrl, returnUrlMethodType: 'Get', paymentViewType: 2, merchantCustomerId: phone, askForContactInformationFieldsType: 4 };
    body.secureHashValue = this.calcHash(body);
    try {
      const res = await this.post<any>('/MerchantOrder/InitializePayment', body);
      return res.success && res.data ? { success: true, paymentUrl: res.data } : { success: false, error: res.message };
    } catch (e: any) { return { success: false, error: e.message }; }
  }

  async payByToken(customerId: string, tokenId: string, amount: number, clientMail?: string): Promise<{ success: boolean; error?: string }> {
    const body: any = { merchantId: this.merchantId, terminalId: this.terminalId, customerId, customerTokenId: tokenId, amount, currencyCode: '512', transactionId: crypto.randomUUID(), requestDateTime: new Date().toISOString() };
    if (clientMail) body.clientMail = clientMail;
    body.secureHashValue = this.calcHash(body);
    try {
      const res = await this.post<any>('/Execute/PayByToken', body);
      return res.success && res.responseCode === '00' ? { success: true } : { success: false, error: res.message };
    } catch (e: any) { return { success: false, error: e.message }; }
  }
}
