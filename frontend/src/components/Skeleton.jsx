import { useMemo } from 'react';

const shimmerKeyframes = `
@keyframes shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}
`;

// Inject keyframes once
if (typeof document !== 'undefined') {
  const styleId = 'skeleton-shimmer-style';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = shimmerKeyframes;
    document.head.appendChild(style);
  }
}

/**
 * Generic skeleton placeholder with shimmer animation.
 */
export function Skeleton({ width = '100%', height = '1rem', borderRadius = '0.5rem', style = {} }) {
  const baseStyle = useMemo(
    () => ({
      width,
      height,
      borderRadius,
      background: `linear-gradient(
        90deg,
        var(--surface) 25%,
        var(--border) 50%,
        var(--surface) 75%
      )`,
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.5s ease-in-out infinite',
      ...style,
    }),
    [width, height, borderRadius, style]
  );

  return <div style={baseStyle} />;
}

/**
 * Card-shaped skeleton matching KPI cards.
 */
export function SkeletonCard() {
  const cardStyle = {
    padding: '1.25rem',
    borderRadius: '1rem',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    height: '150px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
  };

  return (
    <div style={cardStyle}>
      <Skeleton width="40%" height="0.75rem" borderRadius="0.25rem" />
      <Skeleton width="60%" height="1.75rem" borderRadius="0.5rem" />
      <Skeleton width="30%" height="0.75rem" borderRadius="0.25rem" />
    </div>
  );
}

/**
 * Table skeleton with 5 rows (date + description + amount).
 */
export function SkeletonTable({ rows = 5 }) {
  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  };

  const rowStyle = {
    display: 'grid',
    gridTemplateColumns: '100px 1fr 80px',
    gap: '1rem',
    alignItems: 'center',
    padding: '0.75rem 1rem',
    borderRadius: '0.75rem',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
  };

  return (
    <div style={containerStyle}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={rowStyle}>
          <Skeleton width="80px" height="0.875rem" borderRadius="0.25rem" />
          <Skeleton
            width={`${60 + ((i * 17) % 30)}%`}
            height="0.875rem"
            borderRadius="0.25rem"
          />
          <Skeleton width="60px" height="0.875rem" borderRadius="0.25rem" />
        </div>
      ))}
    </div>
  );
}

/**
 * Text skeleton with N lines of varying widths.
 */
export function SkeletonText({ lines = 3 }) {
  const widths = ['80%', '60%', '90%', '70%', '50%', '85%', '65%', '75%'];

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem',
  };

  return (
    <div style={containerStyle}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          width={widths[i % widths.length]}
          height="0.875rem"
          borderRadius="0.25rem"
        />
      ))}
    </div>
  );
}

export default Skeleton;
