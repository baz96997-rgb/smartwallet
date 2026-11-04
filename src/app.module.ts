import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { AiModule } from './ai/ai.module';
import { UserModule } from './user/user.module';
import { PaymentsModule } from './payments/payments.module';
import { User } from './user/user.entity';
import { Conversation } from './user/conversation.entity';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL'),
        entities: [User, Conversation],
        synchronize: true,
        ssl: { rejectUnauthorized: false },
        logging: false,
      }),
    }),
    WhatsAppModule,
    AiModule,
    UserModule,
    PaymentsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
