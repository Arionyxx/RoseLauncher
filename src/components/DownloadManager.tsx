import { FormEvent, useState } from 'react';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { DownloadTask, formatBytes } from '../lib/types';

interface DownloadManagerProps {
  open: boolean;
  onClose: () => void;
  downloads: DownloadTask[];
  onStartDownload: (payload: { url: string; destination: string; fileName?: string }) => Promise<void>;
}

export function DownloadManager({ open, onClose, downloads, onStartDownload }: DownloadManagerProps) {
  const [url, setUrl] = useState('');
  const [destination, setDestination] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);

  const pickDestination = async () => {
    const result = await openDialog({ title: 'Select destination folder', directory: true });
    if (typeof result === 'string') {
      setDestination(result);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!url.trim() || !destination.trim()) return;

    setBusy(true);
    try {
      await onStartDownload({ url: url.trim(), destination: destination.trim(), fileName: fileName.trim() || undefined });
      setUrl('');
      setFileName('');
    } catch (error) {
      console.error(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`download-drawer ${open ? 'open' : ''}`}>
      <header className="download-drawer__header">
        <div>
          <h2>Download Manager</h2>
          <p className="muted">Queue and monitor repack downloads in one place.</p>
        </div>
        <button className="ghost-button" onClick={onClose} type="button">
          Close
        </button>
      </header>

      <form className="download-drawer__form" onSubmit={handleSubmit}>
        <label>
          <span>Download URL</span>
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://..."
            required
          />
        </label>
        <div className="field-group">
          <label>
            <span>Destination folder</span>
            <div className="with-button">
              <input type="text" value={destination} onChange={(event) => setDestination(event.target.value)} required />
              <button type="button" className="ghost-button" onClick={pickDestination}>
                Browse
              </button>
            </div>
          </label>
          <label>
            <span>File name override</span>
            <input
              type="text"
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              placeholder="Optional"
            />
          </label>
        </div>

        <footer className="modal-card__footer">
          <span />
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? 'Queuing…' : 'Start download'}
          </button>
        </footer>
      </form>

      <section className="download-drawer__list">
        {downloads.length === 0 ? (
          <p className="muted">No downloads yet. Queue something to get started.</p>
        ) : (
          downloads.map((download) => (
            <article key={download.id} className={`download-card status-${download.status}`}>
              <header>
                <div>
                  <h3>{download.fileName}</h3>
                  <span className="muted">{download.url}</span>
                </div>
                <span className="status-pill">{download.status.replace('-', ' ')}</span>
              </header>
              <div className="download-progress">
                <div
                  className="download-progress__bar"
                  style={{ width: `${Math.min(100, Math.round(download.progress * 100))}%` }}
                />
              </div>
              <footer>
                <span>
                  {formatBytes(download.bytesReceived)}
                  {download.totalBytes ? ` / ${formatBytes(download.totalBytes)}` : ''}
                </span>
                {download.error ? <span className="error">{download.error}</span> : null}
              </footer>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
