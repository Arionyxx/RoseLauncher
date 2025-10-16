import { clsx } from 'clsx';
import { GameEntry, formatBytes, statusPreset } from '../lib/types';

interface GameCardProps {
  game: GameEntry;
  isSelected: boolean;
  onSelect: () => void;
  onPlay?: () => void;
}

const fallbackGradient = 'linear-gradient(135deg, rgba(203, 166, 247, 0.25), rgba(148, 226, 213, 0.15))';

export function GameCard({ game, isSelected, onSelect, onPlay }: GameCardProps) {
  const status = statusPreset[game.status];

  return (
    <article
      className={clsx('game-card', { selected: isSelected })}
      onClick={onSelect}
      style={{
        background: fallbackGradient,
        borderColor: game.color ?? 'rgba(203, 166, 247, 0.25)',
      }}
    >
      <header className="game-card__header">
        <span className="game-card__status" style={{ background: `${status.hue}20`, color: status.hue }}>
          {status.label}
        </span>
        {game.version ? <span className="game-card__version">v{game.version}</span> : null}
      </header>

      <div className="game-card__body">
        <h3>{game.title}</h3>
        {game.repacker ? <p className="muted">Repacker · {game.repacker}</p> : null}
        {game.sizeBytes ? <p className="muted">Size · {formatBytes(game.sizeBytes)}</p> : null}
        {game.tags?.length ? (
          <div className="game-card__tags">
            {game.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ) : null}
      </div>

      <footer className="game-card__footer">
        <button
          className="ghost-button"
          onClick={(event) => {
            event.stopPropagation();
            onPlay?.();
          }}
        >
          Launch
        </button>
      </footer>
    </article>
  );
}
