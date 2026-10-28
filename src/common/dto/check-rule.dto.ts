export interface PortGroupDto {
  raw: string;
  list: string[];
  protocol: 'TCP' | 'UDP';
}

export class CheckRuleRequestDto {
  sources: string[];
  destinations: string[];
  ports: PortGroupDto[];
  mode?: 'zabbix' | 'mock' | 'socket';
}

export interface SocketCheckItem {
  id: string;
  source: string;
  destination: string;
  port: string;
  protocol: 'TCP' | 'UDP';
  zabbixKey: string;          // net.tcp.port[127.0.0.1, X] или custom.udp.port[X]
  lastvalue: '1' | '0';       // '1' - открыт, '0' - закрыт
  lastclock: number;          // Unix timestamp последней проверки в Zabbix
  status: 'accessible' | 'blocked';
}

export interface CheckRuleResponseDto {
  status: 'accessible' | 'blocked';
  socketResults: SocketCheckItem[];
  log: string;
  checkedAt: string;
}