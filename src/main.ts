import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { json } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*',
  });

  // Увеличиваем лимит тела запроса для сохранения больших матриц в каталог
  app.use(json({ limit: '15mb' }));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Backend запущен: http://localhost:${port}`);
}
bootstrap();