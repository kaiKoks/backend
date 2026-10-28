import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface SavedMatrixSystem {
  id: string;
  name: string;
  updatedAt: string;
  sheets: any[];
}

@Injectable()
export class CatalogService {
  private readonly filePath = path.join(process.cwd(), 'data', 'catalog.json');

  private readCatalogFile(): SavedMatrixSystem[] {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify([], null, 2), 'utf-8');
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw || '[]');
    } catch {
      return [];
    }
  }

  private writeCatalogFile(list: SavedMatrixSystem[]): void {
    fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf-8');
  }

  getAllSystems(): SavedMatrixSystem[] {
    return this.readCatalogFile();
  }

  saveSystem(name: string, sheets: any[]): SavedMatrixSystem {
    const cleanName = (name || 'Новая матрица').trim();
    const list = this.readCatalogFile();
    const existingIdx = list.findIndex(
      (s) => s.name.toLowerCase() === cleanName.toLowerCase(),
    );

    const sysId = existingIdx >= 0 ? list[existingIdx].id : `sys_${Date.now()}`;

    // Обогащаем строки идентификатором и именем системы для глобального поиска и @тегов
    const normalizedSheets = (sheets || []).map((sh) => ({
      ...sh,
      rows: (sh.rows || []).map((r: any) => ({
        ...r,
        __id: `${sysId}_${sh.sheetName}_${r.__rowNumber}`,
        __systemId: sysId,
        __systemName: cleanName,
        __sheetName: sh.sheetName,
      })),
    }));

    const record: SavedMatrixSystem = {
      id: sysId,
      name: cleanName,
      updatedAt: new Date().toLocaleString('ru-RU'),
      sheets: normalizedSheets,
    };

    if (existingIdx >= 0) {
      list[existingIdx] = record;
    } else {
      list.push(record);
    }

    this.writeCatalogFile(list);
    return record;
  }

  deleteSystem(id: string): { deleted: boolean } {
    const list = this.readCatalogFile();
    const filtered = list.filter((s) => s.id !== id);
    this.writeCatalogFile(filtered);
    return { deleted: filtered.length < list.length };
  }
}