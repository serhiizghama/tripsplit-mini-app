/**
 * Trip statistics — 4th bottom-nav tab. Talks to `GET /api/trips/:id/insights`
 * (`useInsights`) and renders:
 *  - a 2×2 KPI grid (total spent, avg/day, days, biggest expense);
 *  - a category breakdown as a CSS `conic-gradient` donut + legend;
 *  - a daily-spend trend as an inline `<svg>` sparkline (no chart lib); and
 *  - a "who spent what" card list with a proportional bar per member.
 *
 * Structure mirrors `BalanceScreen`: `useCurrentTrip()` + a data query,
 * pending/error/no-trip handling, card-mode `List`s, `useFormatters().money`.
 */
import { List } from 'antd-mobile';
import { EXPENSE_CATEGORY_NAME_KEYS } from '@tripsplit/shared';
import type { CategoryTotal, DailyTotal, LargestExpense, MemberSpend, TripMemberView } from '@tripsplit/shared';

import { useCurrentTrip, useInsights } from '../api/queries';
import { ListSkeleton } from '../components/ListSkeleton';
import { MemberAvatar } from '../components/MemberAvatar';
import { TripSwitcherBar } from '../components/TripSwitcherBar';
import { EmptyState, ErrorState, SectionTitle } from '../components/ui';
import { useFormatters, useT } from '../i18n';
import type { Translator } from '../i18n';
import './screens.css';

function memberFirstName(t: Translator, member: TripMemberView | undefined, userId: number): string {
  return member?.firstName ?? t('common.userFallback', { id: userId });
}

// Distinct, accessible categorical palette for the "by category" donut —
// deliberately avoids the app's semantic green/coral (owed/owe on the
// Balance hero) so a category color is never mistaken for balance meaning.
const CATEGORY_COLORS: Record<string, string> = {
  '🍜': '#ff8a3d',
  '🚕': '#f4b400',
  '🏨': '#6a5cff',
  '🎟️': '#00b3a6',
  '🛍️': '#ff5c8a',
  '💊': '#a06bff',
  '📦': '#78909c',
};
// Cycled for a `null`/unknown category not in the curated set above.
const FALLBACK_COLORS = ['#8895a7', '#5c9ead', '#c98a5c', '#7f8fd6', '#9aa5b1'];

function colorForCategory(category: string | null, fallbackIndex: number): string {
  if (category !== null) {
    const known = CATEGORY_COLORS[category];
    if (known) return known;
  }
  return FALLBACK_COLORS[fallbackIndex % FALLBACK_COLORS.length]!;
}

function categoryLabel(t: Translator, category: string | null): string {
  if (category === null) return t('stats.uncategorized');
  const nameKey = (EXPENSE_CATEGORY_NAME_KEYS as Record<string, string | undefined>)[category];
  return nameKey ? `${category} ${t(nameKey)}` : category;
}

function KpiGrid({
  totalBaseMinor,
  avgPerDayBaseMinor,
  dayCount,
  largest,
  baseCurrency,
}: {
  totalBaseMinor: number;
  avgPerDayBaseMinor: number;
  dayCount: number;
  largest: LargestExpense | null;
  baseCurrency: string;
}) {
  const t = useT();
  const { money } = useFormatters();

  return (
    <div className="ts-kpi-grid">
      <div className="ts-kpi-card">
        <div className="ts-kpi-label">{t('stats.totalSpent')}</div>
        <div className="ts-kpi-value ts-nums">{money(totalBaseMinor, baseCurrency)}</div>
      </div>
      <div className="ts-kpi-card">
        <div className="ts-kpi-label">{t('stats.avgPerDay')}</div>
        <div className="ts-kpi-value ts-nums">{money(avgPerDayBaseMinor, baseCurrency)}</div>
      </div>
      <div className="ts-kpi-card">
        <div className="ts-kpi-label">{t('stats.days')}</div>
        <div className="ts-kpi-value ts-nums">{dayCount}</div>
      </div>
      <div className="ts-kpi-card">
        <div className="ts-kpi-label">{t('stats.biggest')}</div>
        <div className="ts-kpi-value ts-nums">
          {largest
            ? `${largest.category ? `${largest.category} ` : ''}${money(largest.amountBaseMinor, baseCurrency)}`
            : '—'}
        </div>
      </div>
    </div>
  );
}

function CategoryDonut({
  byCategory,
  totalBaseMinor,
  baseCurrency,
}: {
  byCategory: CategoryTotal[];
  totalBaseMinor: number;
  baseCurrency: string;
}) {
  const t = useT();
  const { money } = useFormatters();

  // Cumulative percentage-of-total stops feed the conic-gradient directly —
  // each category owns the arc from where the previous one left off.
  let cumulativePct = 0;
  const rows = byCategory.map((c, i) => {
    const color = colorForCategory(c.category, i);
    const pct = totalBaseMinor > 0 ? (c.totalBaseMinor / totalBaseMinor) * 100 : 0;
    const from = cumulativePct;
    cumulativePct += pct;
    return { ...c, color, pct, from, to: cumulativePct };
  });
  const gradient =
    rows.length > 0
      ? `conic-gradient(${rows.map((r) => `${r.color} ${r.from}% ${r.to}%`).join(', ')})`
      : 'var(--ts-separator)';

  return (
    <div className="ts-card ts-card--pad ts-donut-card">
      <div className="ts-donut" style={{ background: gradient }}>
        <div className="ts-donut-hole">
          <div className="ts-donut-total ts-nums">{money(totalBaseMinor, baseCurrency)}</div>
        </div>
      </div>
      <div className="ts-legend">
        {rows.map((row, i) => (
          <div className="ts-legend-row" key={row.category ?? `__uncategorized_${i}`}>
            <span className="ts-legend-swatch" style={{ background: row.color }} aria-hidden="true" />
            <span className="ts-legend-label">{categoryLabel(t, row.category)}</span>
            <span className="ts-legend-pct ts-nums">{row.pct.toFixed(0)}%</span>
            <span className="ts-legend-money ts-nums">{money(row.totalBaseMinor, baseCurrency)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SPARKLINE_WIDTH = 300;
const SPARKLINE_HEIGHT = 64;
const SPARKLINE_PAD_Y = 8;

function DailySparkline({ byDay, baseCurrency }: { byDay: DailyTotal[]; baseCurrency: string }) {
  const t = useT();
  const { money, dayHeader } = useFormatters();

  const values = byDay.map((d) => d.totalBaseMinor);
  const n = values.length;
  const peakTotal = Math.max(...values, 0);
  const max = peakTotal || 1; // guard div-by-zero when every day is 0
  const peakDay = byDay[values.indexOf(peakTotal)] ?? byDay[0]!;

  // A single data point can't draw a "trend" — center one dot instead of
  // dividing by zero on `(n - 1)`.
  const xFor = (i: number) => (n <= 1 ? SPARKLINE_WIDTH / 2 : (i / (n - 1)) * SPARKLINE_WIDTH);
  const yFor = (v: number) =>
    SPARKLINE_PAD_Y + (1 - v / max) * (SPARKLINE_HEIGHT - 2 * SPARKLINE_PAD_Y);

  const points = values.map((v, i) => ({ x: xFor(i), y: yFor(v) }));
  const last = points[n - 1];

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath =
    n >= 2
      ? `${linePath} L ${points[n - 1]!.x.toFixed(1)} ${SPARKLINE_HEIGHT} L ${points[0]!.x.toFixed(1)} ${SPARKLINE_HEIGHT} Z`
      : undefined;

  return (
    <div className="ts-card ts-card--pad ts-sparkline-card">
      <svg
        className="ts-sparkline"
        viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t('stats.dailySpend')}
      >
        {n >= 2 && areaPath && <path d={areaPath} className="ts-sparkline-area" />}
        {n >= 2 && <path d={linePath} className="ts-sparkline-line" fill="none" />}
        {last && <circle cx={last.x} cy={last.y} r={4} className="ts-sparkline-dot" />}
      </svg>
      <div className="ts-sparkline-caption">
        {t('stats.peakCaption', { amount: money(peakDay.totalBaseMinor, baseCurrency), date: dayHeader(peakDay.date) })}
      </div>
    </div>
  );
}

function MemberSpendRow({
  spend,
  member,
  maxPaid,
  baseCurrency,
}: {
  spend: MemberSpend;
  member: TripMemberView | undefined;
  maxPaid: number;
  baseCurrency: string;
}) {
  const t = useT();
  const { money } = useFormatters();
  const muted = spend.paidBaseMinor === 0;
  const pct = maxPaid > 0 ? Math.max(3, (spend.paidBaseMinor / maxPaid) * 100) : 0;

  return (
    <List.Item
      prefix={member ? <MemberAvatar person={member} size={36} /> : undefined}
      description={
        <div className="ts-member-bar-track">
          <div className="ts-member-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      }
      extra={<span className="ts-nums">{money(spend.paidBaseMinor, baseCurrency)}</span>}
    >
      <span className={muted ? 'ts-member-name--muted' : undefined}>
        {memberFirstName(t, member, spend.userId)}
      </span>
    </List.Item>
  );
}

export function StatsScreen() {
  const { tripId, trip } = useCurrentTrip();
  const insightsQuery = useInsights(tripId);
  const t = useT();

  if (tripId === undefined) {
    return (
      <>
        <TripSwitcherBar />
        <EmptyState
          glyph="📊"
          title={t('stats.noTripHeader')}
          description={t('stats.noTripDescription')}
        />
      </>
    );
  }

  if (trip.isPending || insightsQuery.isPending) {
    return (
      <>
        <TripSwitcherBar />
        <SectionTitle>{t('stats.sectionHeader')}</SectionTitle>
        <ListSkeleton rows={4} />
      </>
    );
  }

  if (trip.isError || insightsQuery.isError) {
    const message =
      (trip.isError && trip.error.message) ||
      (insightsQuery.isError && insightsQuery.error.message) ||
      t('common.somethingWrong');
    return (
      <>
        <TripSwitcherBar />
        <ErrorState
          title={t('stats.loadErrorHeader')}
          description={message}
          retryLabel={t('common.retry')}
          onRetry={() => {
            void trip.refetch();
            void insightsQuery.refetch();
          }}
        />
      </>
    );
  }

  if (!trip.data || !insightsQuery.data) return null;

  const insights = insightsQuery.data;

  if (insights.expenseCount === 0) {
    return (
      <>
        <TripSwitcherBar />
        <EmptyState
          glyph="📊"
          title={t('stats.emptyHeader')}
          description={t('stats.emptyDescription')}
        />
      </>
    );
  }

  const membersById = new Map(trip.data.members.map((m) => [m.id, m]));
  const maxPaid = Math.max(...insights.byMember.map((m) => m.paidBaseMinor), 0);

  return (
    <>
      <TripSwitcherBar />
      <div className="ts-section-title ts-section-title--row">
        <span>{t('stats.tripTotals')}</span>
        <span className="ts-section-count">{t('feed.expenseCount', { count: insights.expenseCount })}</span>
      </div>
      <KpiGrid
        totalBaseMinor={insights.totalBaseMinor}
        avgPerDayBaseMinor={insights.avgPerDayBaseMinor}
        dayCount={insights.dayCount}
        largest={insights.largest}
        baseCurrency={insights.baseCurrency}
      />

      {insights.byCategory.length > 0 && (
        <>
          <SectionTitle>{t('stats.byCategory')}</SectionTitle>
          <CategoryDonut
            byCategory={insights.byCategory}
            totalBaseMinor={insights.totalBaseMinor}
            baseCurrency={insights.baseCurrency}
          />
        </>
      )}

      {/* A daily trend only reads as a trend with ≥2 days; a single-day trip
          would render a lone dot in an otherwise empty card, so skip it. */}
      {insights.byDay.length >= 2 && (
        <>
          <SectionTitle>{t('stats.dailySpend')}</SectionTitle>
          <DailySparkline byDay={insights.byDay} baseCurrency={insights.baseCurrency} />
        </>
      )}

      <SectionTitle>{t('stats.byMember')}</SectionTitle>
      <List mode="card">
        {insights.byMember.map((m) => (
          <MemberSpendRow
            key={m.userId}
            spend={m}
            member={membersById.get(m.userId)}
            maxPaid={maxPaid}
            baseCurrency={insights.baseCurrency}
          />
        ))}
      </List>
      <div style={{ height: 12 }} />
    </>
  );
}
