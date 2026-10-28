import { Injectable } from '@nestjs/common';

export interface ZabbixItemResult {
  itemid: string;
  key_: string;
  lastvalue: string;
  lastclock: string;
}

@Injectable()
export class ZabbixApiService {
  private get apiUrl(): string {
    return process.env.ZABBIX_API_URL || 'http://127.0.0.1/zabbix/api_jsonrpc.php';
  }

  private get apiToken(): string {
    return process.env.ZABBIX_API_TOKEN || '';
  }

  // Базовый вызов JSON-RPC 2.0 к Zabbix API
  private async rpcCall<T>(method: string, params: Record<string, any>, id = 1): Promise<T> {
    const payload: Record<string, any> = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    };

    // Поддержка токена в поле auth (согласно регламенту)
    if (this.apiToken) {
      payload.auth = this.apiToken;
    }

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json-rpc',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`Zabbix RPC Error: ${data.error.message} (${data.error.data})`);
    }

    return data.result as T;
  }

  // 1. Поиск hostid в Zabbix по IP-адресу или DNS-имени хоста
  async findHostId(ipOrDns: string): Promise<string | null> {
    // Сначала ищем по сетевым интерфейсам агента (hostinterface.get)
    const interfaces = await this.rpcCall<Array<{ hostid: string }>>('hostinterface.get', {
      output: ['hostid'],
      filter: {
        ip: ipOrDns,
      },
    });

    if (interfaces?.length > 0) {
      return interfaces[0].hostid;
    }

    // Если по IP не найдено — ищем по техническому имени хоста (host.get)
    const hosts = await this.rpcCall<Array<{ hostid: string }>>('host.get', {
      output: ['hostid'],
      search: {
        host: ipOrDns,
      },
    });

    return hosts?.length > 0 ? hosts[0].hostid : null;
  }

  // 2. Запрос элементов данных (item.get) по ключам net.tcp.port или custom.udp.port
  async getHostPortItems(hostId: string, protocol: 'TCP' | 'UDP'): Promise<ZabbixItemResult[]> {
    const searchKey = protocol === 'UDP' ? 'custom.udp.port' : 'net.tcp.port';

    return await this.rpcCall<ZabbixItemResult[]>('item.get', {
      output: ['key_', 'lastvalue', 'lastclock'],
      hostids: hostId,
      search: {
        key_: searchKey,
      },
    });
  }
}