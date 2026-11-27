/** Small line icons for the few controls that have no room for a text label. */
const PATHS = {
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  tidy: 'M4 6h16M4 12h10M4 18h16',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  close: 'M6 6l12 12M18 6 6 18',
} as const;

export type IconName = keyof typeof PATHS | 'play' | 'stop';

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  if (name === 'play' || name === 'stop') {
    return (
      <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        {name === 'play' ? <path d="M7 4.5v15l12-7.5z" /> : <rect x="6" y="6" width="12" height="12" rx="1" />}
      </svg>
    );
  }
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
