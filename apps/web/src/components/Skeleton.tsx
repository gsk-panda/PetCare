/** Skeletons that mirror the shape of what is loading, not a spinner. */
export function TileSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="skel-tiles" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skel skel-tile" />
      ))}
    </div>
  );
}

export function RowSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="skel-stack" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skel skel-row" />
      ))}
    </div>
  );
}

export function LoadingRegion({ label, tiles = true }: { label: string; tiles?: boolean }) {
  return (
    <>
      <span className="sr-only" role="status">
        {label}
      </span>
      {tiles && <TileSkeleton />}
      <div className="card" style={{ padding: 'var(--s-4)' }}>
        <RowSkeleton />
      </div>
    </>
  );
}
