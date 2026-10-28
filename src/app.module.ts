import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CheckerModule } from './modules/checker/checker.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CheckerModule,
    CatalogModule,
  ],
})
export class AppModule {}