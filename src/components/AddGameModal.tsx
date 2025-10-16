import { FormEvent, useEffect, useMemo, useState } from 'react';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import { GameEntry, GamePayload, InstallStatus, formatBytes } from '../lib/types';

interface AddGameModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: GamePayload, id?: string) => Promise<void>;
  initialData?: GameEntry | null;
}

type FormState = {
  title: string;
  version?: string;
  archivePath?: string;
  installPath?: string;
  executablePath?: string;
  repacker?: string;
  tags: string;
  status: InstallStatus;
  notes?: string;
  checksum?: string;
  color?: string;
  sizeOverride?: number;
};

const defaultState: FormState = {
  title: '',
  status: 'not-installed',
  tags: '',
};

export function AddGameModal({ open, onClose, onSubmit, initialData }: AddGameModalProps) {
  const [form, setForm] = useState<FormState>(defaultState);
  const [saving, setSaving] = useState(false);
  const [sizePreview, setSizePreview] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!open) {
      setForm(defaultState);
      setSizePreview(undefined);
      setSaving(false);
      return;
    }

    if (initialData) {
      setForm({
        title: initialData.title,
        version: initialData.version,
        archivePath: initialData.archivePath,
        installPath: initialData.installPath,
        executablePath: initialData.executablePath,
        repacker: initialData.repacker,
        tags: initialData.tags?.join(', ') ?? '',
        status: initialData.status,
        notes: initialData.notes,
        checksum: initialData.checksum,
        color: initialData.color,
        sizeOverride: initialData.sizeBytes,
      });
      setSizePreview(initialData.sizeBytes);
    } else {
      setForm(defaultState);
      setSizePreview(undefined);
    }
  }, [open, initialData]);

  const parsedTags = useMemo(
    () =>
      form.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    [form.tags]
  );

  const updateField = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handlePickArchive = async () => {
    const result = await openDialog({
      title: 'Select repack archive',
      multiple: false,
      filters: [
        { name: 'Archives', extensions: ['exe', 'zip', 'rar', '7z', 'iso'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });

    if (typeof result === 'string') {
      updateField('archivePath', result);
      await refreshSize(result);
    }
  };

  const handlePickInstall = async () => {
    const result = await openDialog({ title: 'Select installation folder', directory: true });
    if (typeof result === 'string') {
      updateField('installPath', result);
      await refreshSize(result);
    }
  };

  const handlePickExecutable = async () => {
    const result = await openDialog({
      title: 'Select game executable',
      multiple: false,
      filters: [{ name: 'Executables', extensions: ['exe', 'bat'] }],
    });

    if (typeof result === 'string') {
      updateField('executablePath', result);
    }
  };

  const refreshSize = async (path: string) => {
    try {
      const size = await invoke<number>('scan_path_size', { path });
      setSizePreview(size);
      updateField('sizeOverride', size);
    } catch (error) {
      console.error('Failed to read size', error);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.title.trim()) return;

    setSaving(true);

    const payload: GamePayload = {
      title: form.title.trim(),
      version: form.version?.trim() || undefined,
      archivePath: form.archivePath,
      installPath: form.installPath,
      executablePath: form.executablePath,
      repacker: form.repacker?.trim() || undefined,
      tags: parsedTags,
      status: form.status,
      notes: form.notes?.trim() || undefined,
      checksum: form.checksum?.trim() || undefined,
      color: form.color?.trim() || undefined,
      sizeOverride: sizePreview,
    };

    try {
      await onSubmit(payload, initialData?.id);
      onClose();
    } catch (error) {
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-card__header">
          <div>
            <h2>{initialData ? 'Edit Game' : 'Add Game'}</h2>
            <p className="muted">Curate and manage your repacks effortlessly.</p>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            Close
          </button>
        </header>

        <form className="modal-card__form" onSubmit={handleSubmit}>
          <div className="field-group">
            <label>
              <span>Title</span>
              <input
                type="text"
                value={form.title}
                onChange={(event) => updateField('title', event.target.value)}
                placeholder="Game name"
                required
              />
            </label>
            <label>
              <span>Version</span>
              <input
                type="text"
                value={form.version ?? ''}
                onChange={(event) => updateField('version', event.target.value)}
                placeholder="1.0.0, Update 2, etc"
              />
            </label>
          </div>

          <div className="field-group">
            <label>
              <span>Archive (FitGirl repack)</span>
              <div className="with-button">
                <input type="text" value={form.archivePath ?? ''} placeholder="Select archive" readOnly />
                <button type="button" className="ghost-button" onClick={handlePickArchive}>
                  Browse
                </button>
              </div>
            </label>
            <label>
              <span>Install folder</span>
              <div className="with-button">
                <input type="text" value={form.installPath ?? ''} placeholder="Select folder" readOnly />
                <button type="button" className="ghost-button" onClick={handlePickInstall}>
                  Browse
                </button>
              </div>
            </label>
          </div>

          <div className="field-group">
            <label>
              <span>Executable</span>
              <div className="with-button">
                <input type="text" value={form.executablePath ?? ''} placeholder="Select executable" readOnly />
                <button type="button" className="ghost-button" onClick={handlePickExecutable}>
                  Browse
                </button>
              </div>
            </label>
            <label>
              <span>Repacker</span>
              <input
                type="text"
                value={form.repacker ?? ''}
                onChange={(event) => updateField('repacker', event.target.value)}
                placeholder="FitGirl, DODI, etc"
              />
            </label>
          </div>

          <label>
            <span>Tags</span>
            <input
              type="text"
              value={form.tags}
              onChange={(event) => updateField('tags', event.target.value)}
              placeholder="RPG, Singleplayer, Online-Coop"
            />
          </label>

          <label>
            <span>Status</span>
            <select value={form.status} onChange={(event) => updateField('status', event.target.value as InstallStatus)}>
              <option value="not-installed">Not installed</option>
              <option value="downloading">Downloading</option>
              <option value="installed">Installed</option>
              <option value="archived">Archived</option>
            </select>
          </label>

          <div className="field-group">
            <label>
              <span>Accent color</span>
              <input type="color" value={form.color ?? '#cba6f7'} onChange={(event) => updateField('color', event.target.value)} />
            </label>
            <label>
              <span>Checksum / Release ID</span>
              <input
                type="text"
                value={form.checksum ?? ''}
                onChange={(event) => updateField('checksum', event.target.value)}
                placeholder="Optional integrity hash"
              />
            </label>
          </div>

          <label>
            <span>Notes</span>
            <textarea
              rows={4}
              value={form.notes ?? ''}
              onChange={(event) => updateField('notes', event.target.value)}
              placeholder="Installation instructions, passwords, etc"
            />
          </label>

          <div className="size-preview">
            <span>Detected size:</span>
            <strong>{formatBytes(sizePreview)}</strong>
            {(form.archivePath || form.installPath) && (
              <button
                type="button"
                className="ghost-button"
                onClick={() => refreshSize(form.archivePath ?? form.installPath ?? '')}
              >
                Rescan
              </button>
            )}
          </div>

          <footer className="modal-card__footer">
            <button type="button" className="ghost-button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={saving}>
              {saving ? 'Saving…' : initialData ? 'Save changes' : 'Add game'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
