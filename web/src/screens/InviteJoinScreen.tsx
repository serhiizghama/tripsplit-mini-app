/**
 * Invite/join flow — Phase 3.3. Reached when `start_param` (the
 * `?startapp=<code>` deep link payload) looks like a valid invite code — see
 * `components/AppShell.tsx`'s launch-routing effect.
 *
 * There's no `GET`-by-invite-code preview endpoint (see plan §5 — only
 * `POST /api/trips/join` exists), so this can't show the trip title before
 * joining; it shows the code and a Join button, which the Phase 3 brief
 * explicitly allows ("or just the code + a Join button"). Joining is
 * idempotent server-side, so there's no harm in the button doing the real
 * join directly.
 *
 * Redesigned onto antd-mobile: the shared `EmptyState` primitive replaces
 * telegram-ui's `Placeholder`. Join logic and the `useJoinTrip` mutation are
 * unchanged.
 */
import { Button } from 'antd-mobile';
import { useNavigate, useSearchParams } from 'react-router';

import { useJoinTrip } from '../api/mutations';
import { useTripJoinInfo } from '../api/queries';
import { EmptyState } from '../components/ui';
import { useT } from '../i18n';
import { useActiveTrip } from '../lib/activeTrip';

export function InviteJoinScreen() {
  const [params] = useSearchParams();
  const code = params.get('code');
  const navigate = useNavigate();
  const joinTrip = useJoinTrip();
  const joinInfo = useTripJoinInfo(code ?? undefined);
  const { setActiveTripId } = useActiveTrip();
  const t = useT();

  function handleJoin() {
    if (!code) return;
    joinTrip.mutate(
      { inviteCode: code },
      {
        onSuccess: (data) => {
          setActiveTripId(data.id);
          navigate('/', { replace: true });
        },
      },
    );
  }

  // No code in the link at all.
  if (!code) {
    return (
      <EmptyState
        glyph="✉️"
        title={t('invite.notFoundHeader')}
        description={t('invite.notFoundDescription')}
      />
    );
  }

  // Code present but no trip matches it (unknown/expired) — the preview 404s.
  if (joinInfo.isError) {
    return (
      <EmptyState
        glyph="✉️"
        title={t('invite.notFoundHeader')}
        description={joinInfo.error.message}
      />
    );
  }

  const info = joinInfo.data;
  // Once the preview resolves, headline the trip name and say who invited +
  // how many are already in; until then, a neutral loading line.
  const title = info ? `«${info.title}»` : t('invite.header');
  const description = joinTrip.isError
    ? joinTrip.error.message
    : info
      ? t('invite.descriptionTrip', {
          name: info.createdByName,
          count: info.memberCount,
        })
      : t('invite.loading');

  return (
    <EmptyState
      glyph="🧳"
      title={title}
      description={description}
      action={
        <Button
          color="primary"
          size="large"
          loading={joinTrip.isPending}
          disabled={joinInfo.isLoading}
          onClick={handleJoin}
        >
          {t('invite.join')}
        </Button>
      }
    />
  );
}
