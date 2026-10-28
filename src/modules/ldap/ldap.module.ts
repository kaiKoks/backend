import { Module } from '@nestjs/common';
import { LdapController } from './ldap.controller.js';
import { LdapService } from './ldap.service.js';

@Module({
  controllers: [LdapController],
  providers: [LdapService],
})
export class LdapModule {}