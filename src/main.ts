import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port);

  Logger.log(`🚀 SmartWallet Backend running on port ${port}`, 'Bootstrap');
  Logger.log(`📱 WhatsApp webhook: POST /webhook/whatsapp`, 'Bootstrap');
}

bootstrap();
