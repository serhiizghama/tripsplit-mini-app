/**
 * TripSplit logo mark — Phase 7.2 (IMPLEMENTATION_PLAN.md §8's branding
 * deliverables). Inline SVG (not an `<img>` to an asset file) so the header
 * mark costs zero extra network requests and stays trivially tree-shakeable
 * — the whole point of §7.5's bundle-size budget. Geometry mirrors
 * `web/src/assets/branding/logo-mark.svg` (the source-of-truth file used to
 * derive the bot avatar / Mini App photo exports) exactly; keep the two in
 * sync if the mark ever changes.
 */
export function LogoMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="TripSplit"
    >
      <rect width="100" height="100" rx="22" fill="#FFFFFF" />
      <circle cx="36" cy="52" r="28" fill="#8FB9FF" />
      <circle cx="36" cy="52" r="20" fill="none" stroke="#FFFFFF" strokeWidth="2" opacity={0.55} />
      <circle cx="64" cy="52" r="28" fill="#1677FF" stroke="#FFFFFF" strokeWidth="4" />
      <circle cx="64" cy="52" r="20" fill="none" stroke="#FFFFFF" strokeWidth="2" opacity={0.55} />
    </svg>
  );
}
