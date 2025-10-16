export type InstallStatus = 'not-installed' | 'downloading' | 'installed' | 'archived';

export interface GamePayload {
  title: string;
  version?: string;
  archivePath?: string;
  installPath?: string;
  executablePath?: string;
  repacker?: string;
  tags: string[];
  status: InstallStatus;
  notes?: string;
  checksum?: string;
  color?: string;
  sizeOverride?: number;
}

export interface GameEntry extends Omit<GamePayload, 'sizeOverride'> {
  id: string;
  sizeBytes?: number;
  addedAt: string;
  updatedAt: string;
}

export interface DownloadTask {
  id: string;
  url: string;
  fileName: string;
  destination: string;
  status: 'queued' | 'in-progress' | 'completed' | 'error';
  progress: number;
  bytesReceived: number;
  totalBytes?: number;
  error?: string;
}

export interface DownloadProgressPayload {
  id: string;
  processed: number;
  total?: number;
  fileName: string;
}

export interface DownloadCompletePayload {
  id: string;
  fileName: string;
  destination: string;
}

export interface DownloadErrorPayload {
  id: string;
  fileName: string;
  message: string;
}

export const statusPreset: Record<InstallStatus, { label: string; hue: string }>
  = {
    'not-installed': { label: 'Not Installed', hue: 'var(--cp-surface2)' },
    downloading: { label: 'Downloading', hue: 'var(--cp-blue)' },
    installed: { label: 'Installed', hue: 'var(--cp-green)' },
    archived: { label: 'Archived', hue: 'var(--cp-peach)' },
  };

export const formatBytes = (bytes?: number): string => {
  if (!bytes || Number.isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

export const formatDate = (input?: string): string => {
  if (!input) return '—';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};
