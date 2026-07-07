/**
 * Settings screen — plan §8 screen 4. Phase 1/2 proved the end-to-end
 * Telegram auth path via the "Account" section; Phase 3 added the "Trip"
 * section — member list with avatars, and the invite link with share/copy
 * actions. Phase 7 adds the language switcher (title edit / base-currency
 * edit remain out of scope, per plan §5's "base currency editable only
 * while trip has no expenses" — no UI ever built for it, deliberately).
 *
 * Redesigned onto antd-mobile (SectionTitle + card-mode `List`s, `Segmented`
 * language switcher, imperative `Toast` for share/copy feedback); all queries,
 * the `useUpdateLang` mutation, share/copy handlers, and i18n are unchanged.
 */
import { Button, List, Segmented, Toast } from 'antd-mobile';
import { hapticFeedback } from '@tma.js/sdk-react';
import type { TripMemberView } from '@tripsplit/shared';
import { useNavigate } from 'react-router';

import { useCurrentTrip, useMe } from '../api/queries';
import { useUpdateLang } from '../api/mutations';
import { ListSkeleton } from '../components/ListSkeleton';
import { MemberAvatar } from '../components/MemberAvatar';
import { EmptyState, ErrorState, SectionTitle } from '../components/ui';
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES, useFormatters, useLocale, useT } from '../i18n';
import type { Locale } from '../i18n';
import { copyToClipboard, shareInviteLink } from '../telegram/share';
import './screens.css';

function MemberRow({ member }: { member: TripMemberView }) {
  const t = useT();
  const { shortDate } = useFormatters();
  return (
    <List.Item
      prefix={<MemberAvatar person={member} />}
      description={
        member.username
          ? `@${member.username}`
          : t('settings.joinedOn', { date: shortDate(member.joinedAt) })
      }
    >
      {[member.firstName, member.lastName].filter(Boolean).join(' ')}
    </List.Item>
  );
}

function InviteSection({
  inviteLink,
  tripTitle,
}: {
  inviteLink: string;
  tripTitle: string;
}) {
  const t = useT();

  async function handleShare() {
    const result = await shareInviteLink(inviteLink, tripTitle);
    if (result === 'copied') Toast.show({ content: t('settings.inviteCopied'), position: 'bottom' });
    else if (result === 'failed') Toast.show({ content: t('settings.shareFailed'), position: 'bottom' });
    // 'opened-share-sheet' hands off to Telegram's own UI — no toast needed.
  }

  async function handleCopy() {
    Toast.show({
      content: (await copyToClipboard(inviteLink)) ? t('settings.inviteCopied') : t('settings.copyFailed'),
      position: 'bottom',
    });
  }

  return (
    <>
      <SectionTitle>{t('settings.invite')}</SectionTitle>
      <List mode="card">
        <List.Item description={inviteLink}>{t('settings.inviteLink')}</List.Item>
      </List>
      <div className="ts-inline-actions" style={{ paddingLeft: 16, paddingRight: 16 }}>
        <Button color="primary" size="small" onClick={() => void handleShare()}>
          {t('settings.share')}
        </Button>
        <Button fill="outline" size="small" onClick={() => void handleCopy()}>
          {t('settings.copy')}
        </Button>
      </div>
      <div className="ts-section-hint">{t('settings.inviteFooter')}</div>
    </>
  );
}

function TripSection() {
  const { tripId, trip } = useCurrentTrip();
  const navigate = useNavigate();
  const t = useT();

  if (tripId === undefined) {
    return (
      <>
        <SectionTitle>{t('settings.tripHeader')}</SectionTitle>
        <EmptyState glyph="🧳" description={t('settings.noTrip')} />
        <div className="ts-section-hint">{t('settings.tripFooterEmpty')}</div>
      </>
    );
  }

  if (trip.isPending) {
    return (
      <>
        <SectionTitle>{t('settings.tripHeader')}</SectionTitle>
        <ListSkeleton rows={2} />
      </>
    );
  }

  if (trip.isError) {
    return (
      <ErrorState
        title={t('settings.tripErrorHeader')}
        description={trip.error.message}
        retryLabel={t('common.retry')}
        onRetry={() => trip.refetch()}
      />
    );
  }

  const memberCountLabel = t('settings.memberCount', { count: trip.data.members.length });
  const baseCurrencyLabel = t('settings.baseCurrency', { currency: trip.data.baseCurrency });

  return (
    <>
      <SectionTitle>{trip.data.title}</SectionTitle>
      <List mode="card">
        {trip.data.members.map((member) => (
          <MemberRow key={member.id} member={member} />
        ))}
      </List>
      <div className="ts-section-hint">{`${memberCountLabel} · ${baseCurrencyLabel}`}</div>

      <List mode="card">
        <List.Item onClick={() => navigate('/trips')}>{t('trips.switchOrNew')}</List.Item>
      </List>

      <InviteSection inviteLink={trip.data.inviteLink} tripTitle={trip.data.title} />
    </>
  );
}

/** Phase 7.1's language switcher — `PATCH /api/me` + instant local `setLocale`. */
function LanguageSection() {
  const t = useT();
  const [locale, setLocale] = useLocale();
  const updateLang = useUpdateLang();

  function handleSelect(next: Locale) {
    if (next === locale) return;
    hapticFeedback.selectionChanged.ifAvailable();
    setLocale(next); // instant UI feedback — no need to wait on the round trip.
    updateLang.mutate({ lang: next });
  }

  return (
    <>
      <SectionTitle>{t('settings.language')}</SectionTitle>
      <div className="ts-card ts-card--pad">
        <Segmented
          block
          value={locale}
          onChange={(value) => handleSelect(value as Locale)}
          options={SUPPORTED_LOCALES.map((code) => ({
            label: LOCALE_NATIVE_NAMES[code],
            value: code,
          }))}
        />
      </div>
      <div className="ts-section-hint">{t('settings.languageFooter')}</div>
    </>
  );
}

export function SettingsScreen() {
  const { data, isPending, isError, error, refetch } = useMe();
  const t = useT();

  return (
    <div style={{ paddingTop: 'calc(8px + env(safe-area-inset-top, 0px))' }}>
      <SectionTitle>{t('settings.account')}</SectionTitle>
      {isPending && <ListSkeleton rows={1} />}

      {isError && (
        <ErrorState
          title={t('settings.profileErrorHeader')}
          description={error.message}
          retryLabel={t('common.retry')}
          onRetry={() => refetch()}
        />
      )}

      {data && (
        <List mode="card">
          <List.Item
            prefix={<MemberAvatar person={data.user} />}
            description={
              data.user.username
                ? `@${data.user.username}`
                : t('settings.telegramId', { id: data.user.id })
            }
          >
            {[data.user.firstName, data.user.lastName].filter(Boolean).join(' ')}
          </List.Item>
        </List>
      )}

      <TripSection />

      <LanguageSection />

      <div className="ts-section-hint">
        {t('settings.ratesByPrefix')}{' '}
        <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">
          {t('settings.exchangeRateApiName')}
        </a>
      </div>
      <div style={{ height: 12 }} />
    </div>
  );
}
