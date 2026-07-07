/**
 * Loading skeleton for Feed/Balance while their queries are in flight —
 * Phase 7.3. A handful of list-row shapes (avatar circle + two text lines)
 * built from antd-mobile's animated `Skeleton`, sized to roughly mimic what's
 * about to load in.
 */
import { Skeleton } from 'antd-mobile';

function SkeletonRow() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 16px',
        minHeight: 44,
      }}
    >
      <Skeleton
        animated
        style={{ '--width': '40px', '--height': '40px', '--border-radius': '50%' }}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Skeleton
          animated
          style={{ '--width': '58%', '--height': '14px', '--border-radius': '6px' }}
        />
        <Skeleton
          animated
          style={{ '--width': '38%', '--height': '12px', '--border-radius': '6px' }}
        />
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        margin: '0 16px',
        background: 'var(--ts-card-bg)',
        borderRadius: 'var(--ts-card-radius)',
        boxShadow: 'var(--ts-shadow-card)',
        overflow: 'hidden',
      }}
    >
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
