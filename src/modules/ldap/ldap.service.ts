import { Injectable } from '@nestjs/common';
import { Client } from 'ldapts';

@Injectable()
export class LdapService {
  private createClient() {
    return new Client({
      url: process.env.LDAP_URL || 'ldap://10.194.199.11:389',
      timeout: 3000,
      connectTimeout: 3000,
    });
  }

  async checkStatus() {
    const url = process.env.LDAP_URL || 'ldap://10.194.199.11:389';
    const client = this.createClient();

    try {
      await client.bind(
        process.env.LDAP_USER_DN || 'svc_matrix',
        process.env.LDAP_PASSWORD || 'password',
      );
      await client.unbind();
      return {
        connected: true,
        server: url,
        message: 'Связь с Active Directory установлена',
      };
    } catch (err: any) {
      return {
        connected: false,
        server: url,
        message: `Контроллер домена недоступен (${err.code || err.message}). Автономный режим.`,
      };
    }
  }

  async getDomainHosts() {
    const client = this.createClient();
    try {
      await client.bind(
        process.env.LDAP_USER_DN || '',
        process.env.LDAP_PASSWORD || '',
      );
      const { searchEntries } = await client.search(
        process.env.LDAP_BASE_DN || 'DC=interrao,DC=ru',
        {
          scope: 'sub',
          filter: '(objectClass=computer)',
          attributes: ['cn', 'dNSHostName', 'operatingSystem'],
        },
      );
      return searchEntries.map((entry) => ({
        hostname: String(entry.dNSHostName || entry.cn),
        operatingSystem: String(entry.operatingSystem || 'Unknown OS'),
      }));
    } catch {
      return [
        { hostname: 'alt1-fm-prx01.interrao.ru', operatingSystem: 'Astra Linux SE 1.7' },
        { hostname: 'alt1-dc01.interrao.ru', operatingSystem: 'Windows Server 2019' },
        { hostname: 'alt1-tochka01.interrao.ru', operatingSystem: 'Astra Linux SE 1.7' },
        { hostname: 'alt1-json02.interrao.ru', operatingSystem: 'Windows Server 2019' },
      ];
    } finally {
      try {
        await client.unbind();
      } catch {}
    }
  }
}