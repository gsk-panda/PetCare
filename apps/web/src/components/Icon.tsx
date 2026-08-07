/**
 * Icon set — authored SVG on a 24px grid, 1.75 stroke, round caps/joins.
 * One consistent vocabulary; no unicode glyphs or emoji standing in for icons.
 */
export type IconName =
  | 'dashboard'
  | 'board'
  | 'care'
  | 'calendar'
  | 'clients'
  | 'close'
  | 'chevronLeft'
  | 'chevronRight'
  | 'plus'
  | 'print'
  | 'download'
  | 'refresh';

const PATHS: Record<IconName, JSX.Element> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="8.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" />
      <rect x="3" y="14.5" width="7.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.5" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9.5h18M9 9.5V20M15 9.5V20" />
    </>
  ),
  care: (
    <>
      <path d="M8 4h8a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
      <path d="M9.5 3.5h5v2.5h-5z" />
      <path d="m9.5 13 2 2 3.5-3.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  clients: (
    <>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.5M17.5 20a5.2 5.2 0 0 0-2-4" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevronLeft: <path d="M14.5 5 8 12l6.5 7" />,
  chevronRight: <path d="M9.5 5 16 12l-6.5 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  print: (
    <>
      <path d="M7 9V4h10v5" />
      <rect x="4" y="9" width="16" height="7" rx="1.5" />
      <path d="M7 14h10v6H7z" />
    </>
  ),
  download: <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-.6 4" />
      <path d="M20 5v6h-6" />
    </>
  ),
};

interface Props {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 16, className }: Props) {
  return (
    <svg
      className={className ? `ico ${className}` : 'ico'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
