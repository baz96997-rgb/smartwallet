import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { User } from './user.entity';
import { Conversation } from './conversation.entity';

const TRIAL_DAYS = 2;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Conversation) private convRepo: Repository<Conversation>,
  ) {}

  async findOrCreate(phone: string): Promise<User> {
    let user = await this.userRepo.findOne({ where: { whatsappPhone: phone } });
    if (!user) {
      user = this.userRepo.create({ whatsappPhone: phone, lastMessageAt: new Date(), onboardingState: 'new' });
      await this.userRepo.save(user);
    }
    return user;
  }

  async updateLastMessage(userId: string) { await this.userRepo.update(userId, { lastMessageAt: new Date() }); }
  async updateState(userId: string, state: string) { await this.userRepo.update(userId, { onboardingState: state }); }
  async saveName(userId: string, name: string) { await this.userRepo.update(userId, { name }); }
  async saveEmail(userId: string, email: string) { await this.userRepo.update(userId, { email }); }

  async activateTrial(userId: string): Promise<Date> {
    const now = new Date();
    const expires = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    await this.userRepo.update(userId, { trialActivated: true, trialStartedAt: now, trialExpiresAt: expires, trialExpired: false, onboardingState: 'active' });
    return expires;
  }

  async hasAccess(user: User): Promise<boolean> {
    if (user.tier === 'pro') return true;
    if (!user.trialActivated || user.trialExpired) return false;
    const expiry = user.trialExpiresAt instanceof Date ? user.trialExpiresAt : new Date(user.trialExpiresAt);
    if (new Date() > expiry) { await this.userRepo.update(user.id, { trialExpired: true, onboardingState: 'expired' }); return false; }
    return true;
  }

  trialHoursLeft(user: User): number {
    if (!user.trialExpiresAt) return 0;
    const expiry = user.trialExpiresAt instanceof Date ? user.trialExpiresAt : new Date(user.trialExpiresAt);
    return Math.max(0, Math.floor((expiry.getTime() - Date.now()) / 3600000));
  }

  async saveMessage(userId: string, role: 'user' | 'assistant', content: string, messageType = 'text') {
    await this.convRepo.save(this.convRepo.create({ userId, role, content, messageType }));
  }

  async getHistory(userId: string, limit = 20): Promise<{ role: string; content: string }[]> {
    const rows = await this.convRepo.find({ where: { userId }, order: { createdAt: 'DESC' }, take: limit });
    return rows.reverse().map(r => ({ role: r.role, content: r.content }));
  }

  async getExpiredUnreminded(): Promise<User[]> {
    return this.userRepo.find({ where: { trialExpired: false, trialActivated: true, trialReminderSent: false, trialExpiresAt: LessThan(new Date()) } });
  }

  async markReminderSent(userId: string) { await this.userRepo.update(userId, { trialReminderSent: true, trialExpired: true, onboardingState: 'expired' }); }

  async activateSubscription(userId: string, amwalCustomerId: string, amwalTokenId: string): Promise<Date> {
    const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.userRepo.update(userId, { tier: 'pro', subscriptionExpiry: expiry, amwalCustomerId, amwalTokenId, onboardingState: 'subscribed', trialExpired: false });
    return expiry;
  }

  async findByPhone(phone: string): Promise<User | null> { return this.userRepo.findOne({ where: { whatsappPhone: phone } }); }
  async findById(id: string): Promise<User | null> { return this.userRepo.findOne({ where: { id } }); }
}
