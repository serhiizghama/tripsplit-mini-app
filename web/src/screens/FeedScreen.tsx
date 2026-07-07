/**
 * Trip feed (home) — plan §8 screen 1, Phase 4.3. Day-grouped list of the
 * current trip's expenses: payer avatar, description/category, amount in
 * its original currency plus the base-currency equivalent. Tapping a row
 * opens the edit sheet; swiping a row left reveals a Delete action (which
 * confirms via a dialog before firing the same delete mutation).
 *
 * Redesigned onto antd-mobile: card-mode `List` per day, `SwipeAction` rows,
 * and a floating add button. All data/logic (queries, mutations, grouping,
 * i18n) is unchanged.
 */
import { Button, Dialog, List, SwipeAction } from 'antd-mobile';
import { AddOutline } from 'antd-mobile-icons';
import type { ExpenseWithShares, TripMemberView } from '@tripsplit/shared';
import { useNavigate } from 'react-router';

import { useDeleteExpense } from '../api/mutations';
import { useCurrentTrip } from '../api/queries';
import { ListSkeleton } from '../components/ListSkeleton';
import { MemberAvatar } from '../components/MemberAvatar';
import { TripSwitcherBar } from '../components/TripSwitcherBar';
import { EmptyState, ErrorState } from '../components/ui';
import { useFormatters, useT } from '../i18n';
import './screens.css';

function groupByDay(
  expenses: ExpenseWithShares[],
): { day: string; items: ExpenseWithShares[] }[] {
  const groups: { day: string; items: ExpenseWithShares[] }[] = [];
  for (const expense of expenses) {
    const current = groups.at(-1);
    if (current && current.day === expense.spentOn) {
      current.items.push(expense);
    } else {
      groups.push({ day: expense.spentOn, items: [expense] });
    }
  }
  return groups;
}

function ExpenseRow({
  expense,
  payer,
  receiver,
  baseCurrency,
  onOpen,
}: {
  expense: ExpenseWithShares;
  payer: TripMemberView | undefined;
  receiver: TripMemberView | undefined;
  baseCurrency: string;
  onOpen: () => void;
}) {
  const deleteExpense = useDeleteExpense(expense.tripId);
  const t = useT();
  const { money } = useFormatters();

  // Settlements (Phase 6.3) are a `type: 'settlement'` row with a single
  // share — the receiver — rendered distinctly ("🤝 Anna → Bo") and not
  // tap-to-edit; deleting a mistaken settlement stays available via swipe.
  const isSettlement = expense.type === 'settlement';
  // A 'planned' expense has no payer yet (budgeted, not in balances). It's
  // rendered under its own feed section; the row shows a "planned" subtitle and
  // stays tap-to-edit so a payer can be assigned (which marks it paid).
  const isPlanned = expense.status === 'planned';
  const someone = t('feed.someone');

  const title = isSettlement
    ? `🤝 ${payer?.firstName ?? someone} → ${receiver?.firstName ?? someone.toLocaleLowerCase()}`
    : [
        expense.category,
        expense.description ||
          (payer ? t('feed.expensePaid', { name: payer.firstName }) : t('feed.expenseFallback')),
      ]
        .filter(Boolean)
        .join(' ');
  const subtitle = isSettlement
    ? expense.description || t('feed.settlementSubtitle')
    : isPlanned
      ? t('feed.plannedBadge')
      : payer
        ? t('feed.paidBy', { name: payer.firstName })
        : undefined;
  const showBaseEquivalent = expense.currency !== baseCurrency;

  function confirmDelete() {
    void Dialog.confirm({
      content: `${t('feed.deleteExpense')}?`,
      confirmText: t('feed.deleteExpense'),
      onConfirm: () => deleteExpense.mutate(expense.id),
    });
  }

  return (
    <SwipeAction
      closeOnAction
      rightActions={[
        {
          key: 'delete',
          text: t('feed.deleteExpense'),
          color: 'danger',
          onClick: confirmDelete,
        },
      ]}
    >
      <List.Item
        prefix={payer ? <MemberAvatar person={payer} /> : undefined}
        description={subtitle}
        clickable={!isSettlement}
        arrowIcon={false}
        onClick={isSettlement ? undefined : onOpen}
        extra={
          <div className="ts-amount ts-nums">
            <div className="ts-amount-main">{money(expense.amountMinor, expense.currency)}</div>
            {showBaseEquivalent && (
              <div className="ts-amount-sub">
                ≈ {money(expense.amountBaseMinor, baseCurrency)}
              </div>
            )}
          </div>
        }
      >
        {title || t('feed.expenseFallback')}
      </List.Item>
    </SwipeAction>
  );
}

export function FeedScreen() {
  const navigate = useNavigate();
  const { tripId, trip } = useCurrentTrip();
  const t = useT();
  const { dayHeader, money } = useFormatters();

  let body: JSX.Element;

  if (tripId === undefined) {
    body = (
      <EmptyState
        glyph="🧳"
        title={t('feed.noTripHeader')}
        description={t('feed.noTripDescription')}
      />
    );
  } else if (trip.isPending) {
    body = <ListSkeleton rows={4} />;
  } else if (trip.isError) {
    body = (
      <ErrorState
        title={t('feed.loadErrorHeader')}
        description={trip.error.message}
        retryLabel={t('common.retry')}
        onRetry={() => trip.refetch()}
      />
    );
  } else {
    const { expenses, members, baseCurrency } = trip.data;
    const membersById = new Map(members.map((m) => [m.id, m]));
    // 'planned' items (budgeted, no payer, not in balances) get their own
    // section; everything else is day-grouped as before.
    const plannedItems = expenses.filter((e) => e.status === 'planned');
    const settledItems = expenses.filter((e) => e.status !== 'planned');
    const dayGroups = groupByDay(settledItems);

    if (expenses.length === 0) {
      body = (
        <EmptyState
          glyph="🧾"
          title={t('feed.noExpensesHeader')}
          description={t('feed.noExpensesDescription')}
          action={
            <Button color="primary" size="large" onClick={() => navigate('/add-expense')}>
              {t('feed.addExpense')}
            </Button>
          }
        />
      );
    } else {
      body = (
        <>
          <div className="ts-page-sub">{t('feed.expenseCount', { count: settledItems.length })}</div>

          {plannedItems.length > 0 && (
            <List mode="card" header={t('feed.plannedHeader')}>
              {plannedItems.map((expense) => (
                <ExpenseRow
                  key={expense.id}
                  expense={expense}
                  payer={undefined}
                  receiver={membersById.get(expense.shares[0]?.userId ?? -1)}
                  baseCurrency={baseCurrency}
                  onOpen={() => navigate(`/expense/${expense.id}`)}
                />
              ))}
            </List>
          )}

          {dayGroups.map((group) => {
            // Day subtotal = that day's spend (expenses only — settlements are
            // transfers, not spend, so they're excluded and never surface a
            // subtotal on their own).
            const daySpendBaseMinor = group.items
              .filter((expense) => expense.type === 'expense')
              .reduce((sum, expense) => sum + expense.amountBaseMinor, 0);

            return (
              <List
                key={group.day}
                mode="card"
                header={
                  <div className="ts-day-header">
                    <span>{dayHeader(group.day)}</span>
                    {daySpendBaseMinor > 0 && (
                      <span className="ts-day-sum ts-nums">
                        {money(daySpendBaseMinor, baseCurrency)}
                      </span>
                    )}
                  </div>
                }
              >
                {group.items.map((expense) => (
                  <ExpenseRow
                    key={expense.id}
                    expense={expense}
                    payer={membersById.get(expense.payerId ?? -1)}
                    receiver={membersById.get(expense.shares[0]?.userId ?? -1)}
                    baseCurrency={baseCurrency}
                    onOpen={() => navigate(`/expense/${expense.id}`)}
                  />
                ))}
              </List>
            );
          })}
          <div className="ts-list-gap" />
        </>
      );
    }
  }

  return (
    <>
      <TripSwitcherBar />
      {body}
      {tripId !== undefined && (
        <button
          type="button"
          className="ts-fab"
          aria-label={t('feed.addExpense')}
          onClick={() => navigate('/add-expense')}
        >
          <AddOutline />
        </button>
      )}
    </>
  );
}
