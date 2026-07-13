/**
 * Slim tappable banner shown atop Feed/Balance for a finished trip (Trip
 * Wrap plan task W4) — both mutation-heavy screens lose their primary CTA
 * once a trip is archived, so this points to the one thing still worth
 * doing there: the wrap page. Shared rather than duplicated per-screen since
 * the copy and behavior are identical either way.
 */
import { useT } from '../i18n';
import '../screens/screens.css';

export function ArchivedTripBanner({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  return (
    <button type="button" className="ts-archived-banner" onClick={onOpen}>
      🏁 {t('common.archivedTripBanner')}
    </button>
  );
}
