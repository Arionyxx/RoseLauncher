import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { AddGameModal } from './components/AddGameModal';
import { GameCard } from './components/GameCard';
import { DownloadManager } from './components/DownloadManager';
import {
  DownloadCompletePayload,
  DownloadErrorPayload,
  DownloadProgressPayload,
  DownloadTask,
  GameEntry,
  GamePayload,
  InstallStatus,
  formatBytes,
  formatDate,
  statusPreset,
} from './lib/types';
import './App.css';

interface DownloadQueuedPayload {
  id: string;
  fileName: string;
  destination: string;
}

const statusOrder: InstallStatus[] = ['downloading', 'installed', 'not-installed', 'archived'];

const toPayload = (game: GameEntry): GamePayload => ({
  title: game.title,
  version: game.version,
  archivePath: game.archivePath,
  installPath: game.installPath,
  executablePath: game.executablePath,
  repacker: game.repacker,
  tags: game.tags ?? [],
  status: game.status,
  notes: game.notes,
  checksum: game.checksum,
  color: game.color,
  sizeOverride: game.sizeBytes,
});

export default function App() {
  const [games, setGames] = useState<GameEntry[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalGame, setModalGame] = useState<GameEntry | null>(null);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [downloads, setDownloads] = useState<DownloadTask[]>([]);

  const selectedGame = useMemo(() => games.find((game) => game.id === selectedGameId) ?? null, [games, selectedGameId]);

  useEffect(() => {
    (async () => {
      try {
        const library = await invoke<GameEntry[]>('load_library');
        setGames(library);
        if (library.length) {
          setSelectedGameId(library[0].id);
        }
      } catch (error) {
        console.error('Failed to load library', error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    let unsubscribers: Array<() => void> = [];

    (async () => {
      const unlistenProgress = await listen<DownloadProgressPayload>('download-progress', ({ payload }) => {
        setDownloads((prev) => {
          const index = prev.findIndex((item) => item.id === payload.id);
          const total = payload.total ?? 0;
          const rawProgress = total > 0 ? payload.processed / total : 0;
          const progressRatio = Math.max(0, Math.min(1, rawProgress));

          if (index >= 0) {
            const copy = [...prev];
            copy[index] = {
              ...copy[index],
              status: 'in-progress',
              bytesReceived: payload.processed,
              totalBytes: payload.total,
              progress: progressRatio,
            };
            return copy;
          }

          const next: DownloadTask = {
            id: payload.id,
            url: '',
            fileName: payload.fileName,
            destination: '',
            status: 'in-progress',
            bytesReceived: payload.processed,
            totalBytes: payload.total,
            progress: progressRatio,
          };

          return [next, ...prev];
        });
      });

      const unlistenComplete = await listen<DownloadCompletePayload>('download-complete', ({ payload }) => {
        setDownloads((prev) =>
          prev.map((item) =>
            item.id === payload.id
              ? {
                  ...item,
                  status: 'completed',
                  progress: 1,
                  bytesReceived: item.totalBytes ?? item.bytesReceived,
                }
              : item
          )
        );
      });

      const unlistenError = await listen<DownloadErrorPayload>('download-error', ({ payload }) => {
        setDownloads((prev) =>
          prev.map((item) =>
            item.id === payload.id
              ? {
                  ...item,
                  status: 'error',
                  error: payload.message,
                }
              : item
          )
        );
      });

      unsubscribers = [unlistenProgress, unlistenComplete, unlistenError];
    })();

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  const filteredGames = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const sorted = [...games].sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) || a.title.localeCompare(b.title));

    if (!query) {
      return sorted;
    }

    return sorted.filter((game) => {
      return (
        game.title.toLowerCase().includes(query) ||
        game.tags?.some((tag) => tag.toLowerCase().includes(query)) ||
        game.repacker?.toLowerCase().includes(query)
      );
    });
  }, [games, searchTerm]);

  const openCreateModal = () => {
    setModalGame(null);
    setModalOpen(true);
  };

  const openEditModal = () => {
    if (!selectedGame) return;
    setModalGame(selectedGame);
    setModalOpen(true);
  };

  const handleSubmitGame = async (payload: GamePayload, id?: string) => {
    if (id) {
      const updated = await invoke<GameEntry>('update_game', { id, payload });
      setGames((prev) => prev.map((game) => (game.id === updated.id ? updated : game)));
      setSelectedGameId(updated.id);
    } else {
      const created = await invoke<GameEntry>('add_game', { payload });
      setGames((prev) => [created, ...prev]);
      setSelectedGameId(created.id);
    }
  };

  const handleRemoveGame = async (id: string) => {
    await invoke('remove_game', { id });
    setGames((prev) => {
      const filtered = prev.filter((game) => game.id !== id);
      if (selectedGameId === id) {
        setSelectedGameId(filtered[0]?.id ?? null);
      }
      return filtered;
    });
  };

  const handleStartDownload = async ({ url, destination, fileName }: { url: string; destination: string; fileName?: string }) => {
    const payload = await invoke<DownloadQueuedPayload>('queue_download', {
      url,
      destination,
      fileName,
    });

    setDownloads((prev) => {
      const nextEntry: DownloadTask = {
        id: payload.id,
        url,
        destination: payload.destination,
        fileName: payload.fileName,
        status: 'queued',
        progress: 0,
        bytesReceived: 0,
      };

      const index = prev.findIndex((item) => item.id === payload.id);
      if (index >= 0) {
        const copy = [...prev];
        copy[index] = { ...copy[index], ...nextEntry };
        return copy;
      }

      return [nextEntry, ...prev];
    });
    setDownloadsOpen(true);
  };

  const updateStatus = async (status: InstallStatus) => {
    if (!selectedGame) return;
    const payload: GamePayload = { ...toPayload(selectedGame), status };
    const updated = await invoke<GameEntry>('update_game', { id: selectedGame.id, payload });
    setGames((prev) => prev.map((game) => (game.id === updated.id ? updated : game)));
  };

  const openPath = async (path?: string | null) => {
    if (!path) return;
    try {
      await invoke('open_path', { path });
    } catch (error) {
      console.error(error);
    }
  };

  const handleScanSize = async () => {
    if (!selectedGame) return;
    const target = selectedGame.installPath ?? selectedGame.archivePath;
    if (!target) return;
    try {
      const size = await invoke<number>('scan_path_size', { path: target });
      const payload: GamePayload = { ...toPayload(selectedGame), sizeOverride: size };
      const updated = await invoke<GameEntry>('update_game', { id: selectedGame.id, payload });
      setGames((prev) => prev.map((game) => (game.id === updated.id ? updated : game)));
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__header">
          <div className="logo">
            <span className="logo__glyph">🌙</span>
            <div>
              <strong>RoseLauncher</strong>
              <small>Catppuccin infused</small>
            </div>
          </div>
          <button className="primary-button" onClick={openCreateModal}>
            Add game
          </button>
        </div>

        <div className="sidebar__search">
          <input
            type="search"
            placeholder="Search library"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <nav className="sidebar__nav">
          <button className="ghost-button" onClick={() => setDownloadsOpen(true)}>
            Downloads ({downloads.length})
          </button>
          <button className="ghost-button" onClick={openEditModal} disabled={!selectedGame}>
            Edit selected
          </button>
          <button
            className="ghost-button danger"
            onClick={() => selectedGame && handleRemoveGame(selectedGame.id)}
            disabled={!selectedGame}
          >
            Remove selected
          </button>
        </nav>
      </aside>

      <main className="main-content">
        <header className="main-header">
          <div>
            <h1>Your library</h1>
            <p className="muted">Curate your downloaded repacks, queue fresh installs, and launch instantly.</p>
          </div>
          <div className="header-actions">
            <button className="ghost-button" onClick={() => setDownloadsOpen(true)}>
              Open downloads
            </button>
            <button className="primary-button" onClick={openCreateModal}>
              New game
            </button>
          </div>
        </header>

        <section className="content-grid">
          <div className="library-collection">
            {loading ? (
              <div className="empty">
                <p>Loading library…</p>
              </div>
            ) : filteredGames.length ? (
              <div className="game-grid">
                {filteredGames.map((game) => (
                  <GameCard
                    key={game.id}
                    game={game}
                    isSelected={selectedGameId === game.id}
                    onSelect={() => setSelectedGameId(game.id)}
                    onPlay={() => openPath(game.executablePath ?? game.installPath ?? game.archivePath)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty">
                <p>No games tracked yet.</p>
                <button className="primary-button" onClick={openCreateModal}>
                  Start by adding one
                </button>
              </div>
            )}
          </div>

          <aside className="details-panel">
            {selectedGame ? (
              <div className="details-card" style={{ borderColor: selectedGame.color ?? 'transparent' }}>
                <header>
                  <h2>{selectedGame.title}</h2>
                  <span className="status-pill" style={{ background: `${statusPreset[selectedGame.status].hue}20`, color: statusPreset[selectedGame.status].hue }}>
                    {statusPreset[selectedGame.status].label}
                  </span>
                </header>

                <div className="details-section">
                  <dl>
                    {selectedGame.version ? (
                      <div>
                        <dt>Version</dt>
                        <dd>{selectedGame.version}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Repacker</dt>
                      <dd>{selectedGame.repacker ?? 'Unknown'}</dd>
                    </div>
                    <div>
                      <dt>Size</dt>
                      <dd>{formatBytes(selectedGame.sizeBytes)}</dd>
                    </div>
                    <div>
                      <dt>Added</dt>
                      <dd>{formatDate(selectedGame.addedAt)}</dd>
                    </div>
                    <div>
                      <dt>Updated</dt>
                      <dd>{formatDate(selectedGame.updatedAt)}</dd>
                    </div>
                    {selectedGame.tags?.length ? (
                      <div>
                        <dt>Tags</dt>
                        <dd className="tag-list">
                          {selectedGame.tags.map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </div>

                <div className="details-section">
                  <h3>Paths</h3>
                  <ul className="path-list">
                    {selectedGame.installPath ? (
                      <li>
                        <span>Install</span>
                        <button className="ghost-button" onClick={() => openPath(selectedGame.installPath)}>
                          Open folder
                        </button>
                      </li>
                    ) : null}
                    {selectedGame.archivePath ? (
                      <li>
                        <span>Archive</span>
                        <button className="ghost-button" onClick={() => openPath(selectedGame.archivePath)}>
                          Reveal file
                        </button>
                      </li>
                    ) : null}
                    {selectedGame.executablePath ? (
                      <li>
                        <span>Executable</span>
                        <button className="primary-button" onClick={() => openPath(selectedGame.executablePath)}>
                          Launch
                        </button>
                      </li>
                    ) : null}
                  </ul>
                </div>

                {selectedGame.notes ? (
                  <div className="details-section">
                    <h3>Notes</h3>
                    <p className="notes-block">{selectedGame.notes}</p>
                  </div>
                ) : null}

                <div className="details-actions">
                  <button className="ghost-button" onClick={() => updateStatus('installed')}>
                    Mark installed
                  </button>
                  <button className="ghost-button" onClick={() => updateStatus('not-installed')}>
                    Mark not installed
                  </button>
                  <button className="ghost-button" onClick={() => updateStatus('archived')}>
                    Archive
                  </button>
                  <button className="ghost-button" onClick={handleScanSize}>
                    Rescan size
                  </button>
                </div>
              </div>
            ) : (
              <div className="empty">
                <p>Select a game to view details.</p>
              </div>
            )}
          </aside>
        </section>
      </main>

      <AddGameModal open={modalOpen} onClose={() => setModalOpen(false)} onSubmit={handleSubmitGame} initialData={modalGame ?? undefined} />
      <DownloadManager open={downloadsOpen} onClose={() => setDownloadsOpen(false)} downloads={downloads} onStartDownload={handleStartDownload} />
    </div>
  );
}
