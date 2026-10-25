import type { FinanceData } from './domain.ts';

export const BACKUP_STORAGE_KEY = 'duo-v4-data';
export const BACKUP_FORMAT = 'duo-finance-backup';
export const BACKUP_VERSION = 1;

export type FinanceBackup = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  storageKey: typeof BACKUP_STORAGE_KEY;
  data: FinanceData;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isFinanceData(value: unknown): value is FinanceData {
  if (!isRecord(value)) return false;
  return ['accounts', 'entries', 'categories', 'incomeSources', 'goals', 'incomeGoals', 'incomeQuotes']
    .every(key => Array.isArray(value[key])) &&
    isRecord(value.businessOpening) && isRecord(value.budget) &&
    (value.pasanaco === null || isRecord(value.pasanaco)) &&
    (value.incomeGoal === null || isRecord(value.incomeGoal));
}

export function createFinanceBackup(storage: Pick<Storage, 'getItem'>, exportedAt = new Date()): FinanceBackup {
  const raw = storage.getItem(BACKUP_STORAGE_KEY);
  if (raw === null) throw new Error('No hay datos guardados para respaldar en este navegador.');

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Los datos guardados no son un JSON válido. No se generó el respaldo.');
  }
  if (!isFinanceData(data)) throw new Error('Los datos guardados están incompletos. No se generó el respaldo.');

  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: exportedAt.toISOString(), storageKey: BACKUP_STORAGE_KEY, data };
}

// Valida el formato para una futura función de restauración. No escribe en localStorage.
export function parseFinanceBackup(json: string): FinanceBackup {
  const backup: unknown = JSON.parse(json);
  if (!isRecord(backup) || backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION ||
      backup.storageKey !== BACKUP_STORAGE_KEY || typeof backup.exportedAt !== 'string' ||
      !isFinanceData(backup.data)) {
    throw new Error('El archivo no es un respaldo compatible de Duo Finance.');
  }
  return backup as FinanceBackup;
}

export function downloadFinanceBackup(storage: Pick<Storage, 'getItem'> = localStorage): string {
  const backup = createFinanceBackup(storage);
  const filename = `duo-finance-respaldo-${backup.exportedAt.replace(/[:.]/g, '-')}.json`;
  const blob = new Blob([JSON.stringify(backup, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return filename;
}

// Exporta una lectura reciente de Supabase sin escribirla en localStorage.
export function downloadSharedFinanceBackup(data: FinanceData): string {
  return downloadFinanceBackup({ getItem: key => key === BACKUP_STORAGE_KEY ? JSON.stringify(data) : null });
}
