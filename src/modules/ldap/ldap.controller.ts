import { Controller, Get } from '@nestjs/common';
import { LdapService } from './ldap.service.js';

@Controller('api/ldap')
export class LdapController {
  constructor(private readonly ldapService: LdapService) {}

  @Get('status')
  getStatus() {
    return this.ldapService.checkStatus();
  }

  @Get('hosts')
  getHosts() {
    return this.ldapService.getDomainHosts();
  }
}