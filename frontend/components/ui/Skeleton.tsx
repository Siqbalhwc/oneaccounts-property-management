/**
 * A single shimmering placeholder block. Size it with className (height,
 * width, rounding) to roughly match the shape of whatever real content is
 * about to replace it -- a short bar for a KPI number, a circle for a ring
 * or avatar, a wide bar for a table row. Swap in wherever a card currently
 * shows plain "Loading…" text.
 */
export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} />;
}
