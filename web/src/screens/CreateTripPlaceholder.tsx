/**
 * Create-trip form — Phase 3.2. Shown when the authenticated user has no
 * trips yet and didn't arrive via an invite link (the Phase 2.4 launch-
 * routing effect in `components/AppShell.tsx` sends them here automatically),
 * or when reached by explicit navigation.
 *
 * Currency picker: `CurrencyPicker` (Phase 5.1) — the curated top list from
 * plan §6 (trip base/last-used aren't applicable yet here, there's no trip),
 * then a searchable full list for the other ~160 registry entries.
 *
 * Redesigned onto antd-mobile (card sections + `SectionTitle`); all form
 * state, validation, and the `useCreateTrip` mutation are unchanged. Note
 * antd-mobile inputs pass their value directly to `onChange` (not a DOM event).
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Input } from 'antd-mobile';
import { useNavigate } from 'react-router';

import { useCreateTrip } from '../api/mutations';
import { CurrencyPicker } from '../components/CurrencyPicker';
import { SectionTitle } from '../components/ui';
import { useT } from '../i18n';
import { useActiveTrip } from '../lib/activeTrip';
import './screens.css';

// USD is a neutral default (not tied to the curated top list's ordering,
// which leads with THB/VND/LAK/UAH for a different reason — see
// `TOP_CURRENCY_CODES`'s doc comment in shared/src/currencies.ts).
const DEFAULT_CURRENCY_CODE = 'USD';

export function CreateTripPlaceholder() {
  const navigate = useNavigate();
  const createTrip = useCreateTrip();
  const { setActiveTripId } = useActiveTrip();
  const t = useT();
  const [title, setTitle] = useState('');
  const [baseCurrency, setBaseCurrency] = useState(DEFAULT_CURRENCY_CODE);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !createTrip.isPending;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    createTrip.mutate(
      { title: trimmedTitle, baseCurrency },
      {
        onSuccess: (res) => {
          setActiveTripId(res.trip.id);
          navigate('/', { replace: true });
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <SectionTitle>{t('createTrip.header')}</SectionTitle>
      <div className="ts-card ts-card--pad">
        <Input
          placeholder={t('createTrip.titlePlaceholder')}
          value={title}
          onChange={(val) => setTitle(val)}
          autoFocus
        />
      </div>
      <div className="ts-section-hint">{t('createTrip.footer')}</div>

      <SectionTitle>{t('createTrip.baseCurrencyHeader')}</SectionTitle>
      <div className="ts-card">
        <CurrencyPicker value={baseCurrency} onChange={setBaseCurrency} />
      </div>
      <div className="ts-section-hint">{t('createTrip.baseCurrencyFooter')}</div>

      {createTrip.isError && (
        <div className="ts-form-error" role="alert">
          ⚠️ {createTrip.error.message}
        </div>
      )}

      <div className="ts-sheet-actions">
        <Button
          type="submit"
          color="primary"
          size="large"
          block
          disabled={!canSubmit}
          loading={createTrip.isPending}
        >
          {t('createTrip.submit')}
        </Button>
      </div>
    </form>
  );
}
