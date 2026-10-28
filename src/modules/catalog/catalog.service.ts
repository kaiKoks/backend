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
      return [];
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed: SavedMatrixSystem[] = JSON.parse(raw || '[]');
      // Автоматически отсеиваем поврежденные/пустые матрицы без строк
      return parsed.filter(
        (sys) =>
          Array.isArray(sys.sheets) &&
          sys.sheets.some((sh) => Array.isArray(sh.rows) && sh.rows.length > 0),
      );
    } catch {
      return [];
    }
  }

  private writeCatalogFile(list: SavedMatrixSystem[]): void {
    fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf-8');
  }

  getAllSystems(): SavedMatrixSystem[] {
    const valid = this.readCatalogFile();
    this.writeCatalogFile(valid);
    return valid;
  }

  saveSystem(name: string, sheets: any[]): SavedMatrixSystem {
    const cleanName = (name || 'Матрица').trim();
    const list = this.readCatalogFile();
    const existingIdx = list.findIndex(
      (s) => s.name.toLowerCase() === cleanName.toLowerCase(),
    );

    const sysId = existingIdx >= 0 ? list[existingIdx].id : `sys_${Date.now()}`;

    const normalizedSheets = (sheets || [])
      .filter((sh) => Array.isArray(sh.rows) && sh.rows.length > 0)
      .map((sh) => ({
        ...sh,
        rows: sh.rows.map((r: any, idx: number) => ({
          ...r,
          __id: `${sysId}_${sh.sheetName}_${r.__rowNumber || idx + 1}`,
          __systemId: sysId,
          __systemName: cleanName,
          __sheetName: sh.sheetName,
        })),
      }));

    const totalRows = normalizedSheets.reduce((acc, s) => acc + s.rows.length, 0);
    console.log(`[Catalog] Сохранена матрица "${cleanName}" (листов: ${normalizedSheets.length}, строк: ${totalRows})`);

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
    console.log(`[Catalog] Удалена матрица ID=${id}`);
    return { deleted: filtered.length < list.length };
  }
}