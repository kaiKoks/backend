import { Injectable } from '@nestjs/common';
import * as net from 'net';
import * as dgram from 'dgram';
import { ZabbixApiService } from './zabbix-api.service.js';
import {
  CheckRuleRequestDto,
  CheckRuleResponseDto,
  SocketCheckItem,
} from '../../common/dto/check-rule.dto.js';

interface RawCombination {
  id: string;
  source: string;
  destination: string;
  cleanDestHost: string;
  port: string;
  protocol: 'TCP' | 'UDP';
  zabbixKey: string;
}

@Injectable()
export class CheckerService {
  constructor(private readonly zabbixApi: ZabbixApiService) {}

  // Извлекает чистый IP или FQDN из строк вида "10.194.199.11/alt1-dc01.interrao.ru." или URL
  private extractCleanHost(rawEndpoint: string): string {
    const cleaned = rawEndpoint.trim();
    if (/^https?:\/\//i.test(cleaned)) {
      try {
        return new URL(cleaned).hostname;
      } catch {
        // ignore
      }
    }
    if (cleaned.includes('/')) {
      return cleaned.split('/')[0].trim();
    }
    return cleaned.replace(/\.$/, '');
  }

  // Разворачивает короткие диапазоны портов ("15000-15001" -> ["15000", "15001"])
  private expandPortToken(token: string): string[] {
    const clean = token.replace(/^(tcp|udp)\//i, '').trim();
    const rangeMatch = clean.match(/^(\d+)\s*[–-]\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      const diff = end - start;
      if (diff > 0 && diff <= 5) {
        return Array.from({ length: diff + 1 }, (_, i) => String(start + i));
      }
      return [clean];
    }
    return /^\d+$/.test(clean) ? [clean] : [];
  }

  // Строит все комбинации Source × Destination × Port
  private buildCombinations(dto: CheckRuleRequestDto): RawCombination[] {
    const sources = dto.sources?.length ? dto.sources : ['LocalHost'];
    const destinations = dto.destinations?.length ? dto.destinations : ['Unknown'];
    const combinations: RawCombination[] = [];

    for (const src of sources) {
      for (const dst of destinations) {
        const cleanDestHost = this.extractCleanHost(dst);

        for (const portGroup of dto.ports || []) {
          for (const rawPort of portGroup.list || []) {
            const expanded = this.expandPortToken(rawPort);

            for (const port of expanded) {
              const zabbixKey =
                portGroup.protocol === 'UDP'
                  ? `custom.udp.port[${port}]`
                  : `net.tcp.port[127.0.0.1, ${port}]`;

              combinations.push({
                id: `${src}->${dst}:${port}/${portGroup.protocol}`,
                source: src,
                destination: dst,
                cleanDestHost,
                port,
                protocol: portGroup.protocol,
                zabbixKey,
              });
            }
          }
        }
      }
    }

    return combinations;
  }

  async checkRule(dto: CheckRuleRequestDto): Promise<CheckRuleResponseDto> {
    const mode = dto.mode || (process.env.CHECKER_MODE as any) || 'mock';
    const combinations = this.buildCombinations(dto);

    if (mode === 'zabbix') {
      try {
        return await this.checkViaZabbixApi(combinations);
      } catch (err: any) {
        // Если Zabbix-сервер еще не развернут, возвращаем эмуляцию с пометкой в логе
        const fallback = await this.checkViaMock(combinations);
        fallback.log =
          `[ВНИМАНИЕ] Zabbix API недоступен (${err.message}). Выполнен отказоустойчивый переход в режим эмуляции.\n\n` +
          fallback.log;
        return fallback;
      }
    }

    if (mode === 'socket') {
      return await this.checkViaDirectSockets(combinations);
    }

    return await this.checkViaMock(combinations);
  }

  // 1. Боевой опрос через Zabbix API (JSON-RPC 2.0 method: "item.get")
  private async checkViaZabbixApi(combinations: RawCombination[]): Promise<CheckRuleResponseDto> {
    const socketResults: SocketCheckItem[] = [];
    const nowUnix = Math.floor(Date.now() / 1000);
    const logLines: string[] = [
      `[${new Date().toLocaleTimeString()}] Zabbix API JSON-RPC 2.0 (method: "item.get")`,
      `Проверено связок (IP × Порт): ${combinations.length}`,
      `------------------------------------------------------------`,
    ];

    // Кэшируем найденные hostid и их items, чтобы не делать лишних запросов для одного хоста
    const hostItemsCache = new Map<string, Map<string, { lastvalue: string; lastclock: number }>>();

    for (const combo of combinations) {
      const cacheKey = `${combo.cleanDestHost}_${combo.protocol}`;

      if (!hostItemsCache.has(cacheKey)) {
        const itemsMap = new Map<string, { lastvalue: string; lastclock: number }>();
        const hostId = await this.zabbixApi.findHostId(combo.cleanDestHost);

        if (hostId) {
          const items = await this.zabbixApi.getHostPortItems(hostId, combo.protocol);
          items.forEach((item) => {
            itemsMap.set(item.key_.replace(/\s+/g, ''), {
              lastvalue: item.lastvalue,
              lastclock: parseInt(item.lastclock, 10) || nowUnix,
            });
          });
        }
        hostItemsCache.set(cacheKey, itemsMap);
      }

      const itemsMap = hostItemsCache.get(cacheKey)!;
      const normalizedLookupKey = combo.zabbixKey.replace(/\s+/g, '');
      const foundItem = itemsMap.get(normalizedLookupKey);

      const isOpen = foundItem?.lastvalue === '1';
      const lastvalue: '1' | '0' = isOpen ? '1' : '0';
      const lastclock = foundItem?.lastclock || nowUnix;

      socketResults.push({
        id: combo.id,
        source: combo.source,
        destination: combo.destination,
        port: combo.port,
        protocol: combo.protocol,
        zabbixKey: combo.zabbixKey,
        lastvalue,
        lastclock,
        status: isOpen ? 'accessible' : 'blocked',
      });

      const destWithPort = combo.destination.endsWith(`:${combo.port}`)
        ? combo.destination
        : `${combo.destination}:${combo.port}`;

      logLines.push(
        `[${combo.protocol}] ${combo.source} -> ${destWithPort}\n` +
          `  key_: "${combo.zabbixKey}" | lastvalue: "${lastvalue}" | lastclock: ${new Date(
            lastclock * 1000,
          ).toLocaleTimeString()}`,
      );
    }

    const hasAtLeastOneOpen = socketResults.some((s) => s.status === 'accessible');

    return {
      status: hasAtLeastOneOpen ? 'accessible' : 'blocked',
      socketResults,
      log: logLines.join('\n'),
      checkedAt: new Date().toLocaleTimeString(),
    };
  }

  // 2. Режим эмуляции Zabbix API (для локальной отладки и демонстрации)
  private async checkViaMock(combinations: RawCombination[]): Promise<CheckRuleResponseDto> {
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 250));

    const nowUnix = Math.floor(Date.now() / 1000);
    const socketResults: SocketCheckItem[] = [];
    const logLines: string[] = [
      `[${new Date().toLocaleTimeString()}] POST /zabbix/api_jsonrpc.php (method: "item.get")`,
      `Проверено связок (IP × Порт): ${combinations.length}`,
      `------------------------------------------------------------`,
    ];

    for (const combo of combinations) {
      const isOpen = Math.random() > 0.2;
      const lastvalue: '1' | '0' = isOpen ? '1' : '0';
      const lastclock = nowUnix - Math.floor(2 + Math.random() * 40);

      socketResults.push({
        id: combo.id,
        source: combo.source,
        destination: combo.destination,
        port: combo.port,
        protocol: combo.protocol,
        zabbixKey: combo.zabbixKey,
        lastvalue,
        lastclock,
        status: isOpen ? 'accessible' : 'blocked',
      });

      const destWithPort = combo.destination.endsWith(`:${combo.port}`)
        ? combo.destination
        : `${combo.destination}:${combo.port}`;

      logLines.push(
        `[${combo.protocol}] ${combo.source} -> ${destWithPort}\n` +
          `  key_: "${combo.zabbixKey}" | lastvalue: "${lastvalue}" | lastclock: ${new Date(
            lastclock * 1000,
          ).toLocaleTimeString()}`,
      );
    }

    const hasAtLeastOneOpen = socketResults.some((s) => s.status === 'accessible');

    return {
      status: hasAtLeastOneOpen ? 'accessible' : 'blocked',
      socketResults,
      log: logLines.join('\n'),
      checkedAt: new Date().toLocaleTimeString(),
    };
  }

  // 3. Резервный режим прямой проверки сокетов с сервера бэкенда
  private async checkViaDirectSockets(
    combinations: RawCombination[],
  ): Promise<CheckRuleResponseDto> {
    const socketResults: SocketCheckItem[] = [];
    const nowUnix = Math.floor(Date.now() / 1000);
    const logLines: string[] = [
      `[${new Date().toLocaleTimeString()}] Прямая проверка сокетов (Direct Socket Mode)`,
      `Проверено связок: ${combinations.length}`,
      `------------------------------------------------------------`,
    ];

    for (const combo of combinations) {
      const portNum = parseInt(combo.port, 10) || 80;
      const isOpen =
        combo.protocol === 'UDP'
          ? await this.testUdpSocket(combo.cleanDestHost, portNum)
          : await this.testTcpSocket(combo.cleanDestHost, portNum);

      const lastvalue: '1' | '0' = isOpen ? '1' : '0';

      socketResults.push({
        id: combo.id,
        source: combo.source,
        destination: combo.destination,
        port: combo.port,
        protocol: combo.protocol,
        zabbixKey: combo.zabbixKey,
        lastvalue,
        lastclock: nowUnix,
        status: isOpen ? 'accessible' : 'blocked',
      });

      logLines.push(
        `[${combo.protocol}] ${combo.source} -> ${combo.cleanDestHost}:${portNum} | lastvalue: "${lastvalue}"`,
      );
    }

    const hasAtLeastOneOpen = socketResults.some((s) => s.status === 'accessible');

    return {
      status: hasAtLeastOneOpen ? 'accessible' : 'blocked',
      socketResults,
      log: logLines.join('\n'),
      checkedAt: new Date().toLocaleTimeString(),
    };
  }

  private testTcpSocket(host: string, port: number, timeout = 2000): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeout);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, host);
    });
  }

  private testUdpSocket(host: string, port: number, timeout = 1500): Promise<boolean> {
    return new Promise((resolve) => {
      const client = dgram.createSocket('udp4');
      const timer = setTimeout(() => {
        client.close();
        resolve(true);
      }, timeout);
      client.on('error', () => {
        clearTimeout(timer);
        client.close();
        resolve(false);
      });
      client.send(Buffer.from('\x00'), port, host, (err) => {
        if (err) {
          clearTimeout(timer);
          client.close();
          resolve(false);
        }
      });
    });
  }
}