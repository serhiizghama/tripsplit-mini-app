/**
 * Shared presentational primitives for the Ant Design Mobile redesign. These
 * are pure UI — no data, no business logic — reused across screens so the
 * chip pickers, section headers, and modal sheets all read as one system.
 */
import type { ReactNode } from 'react';
import { Button, NavBar, Popup } from 'antd-mobile';
import { CloseOutline } from 'antd-mobile-icons';

import './ui.css';

/** A single-select pill, matching antd-mobile Selector's tinted selected state. */
export function Chip({
  selected,
  onClick,
  children,
  title,
  ariaLabel,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className={`ts-chip${selected ? ' ts-chip--selected' : ''}`}
      aria-pressed={selected}
      title={title}
      aria-label={ariaLabel ?? title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Flex-wrap container for a row of `Chip`s. `centered` — symmetric padding for a row that sits alone in a card. */
export function ChipRow({
  children,
  centered,
}: {
  children: ReactNode;
  centered?: boolean;
}) {
  return (
    <div className={centered ? 'ts-chip-row ts-chip-row--centered' : 'ts-chip-row'}>
      {children}
    </div>
  );
}

/** Fixed 4-column grid container for `CategoryTile`s. */
export function CategoryGrid({ children }: { children: ReactNode }) {
  return <div className="ts-cat-grid">{children}</div>;
}

/**
 * A single-select category tile: emoji glyph stacked over a short label. Unlike
 * an icon-only `Chip`, the label is always visible so the category is readable
 * on touch (where a `title` tooltip never shows). Tiles are uniform height —
 * the label reserves two lines so one- and two-word names line up in the grid.
 */
export function CategoryTile({
  selected,
  onClick,
  glyph,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  glyph: ReactNode;
  label: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`ts-cat-tile${selected ? ' ts-cat-tile--selected' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="ts-cat-tile__glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="ts-cat-tile__label">{label}</span>
    </button>
  );
}

/** Small uppercase label above a card-mode `List`. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="ts-section-title">{children}</div>;
}

/**
 * Centered empty/placeholder state — a large emoji glyph, a heading, a line of
 * copy, and an optional primary action. Replaces telegram-ui's `Placeholder`
 * across the app so every "nothing here yet" moment reads the same.
 */
export function EmptyState({
  glyph,
  title,
  description,
  action,
}: {
  glyph: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ts-empty">
      <div className="ts-empty-glyph" aria-hidden="true">
        {glyph}
      </div>
      {title && <div className="ts-empty-title">{title}</div>}
      {description && <div className="ts-empty-desc">{description}</div>}
      {action && <div className="ts-empty-action">{action}</div>}
    </div>
  );
}

/** Error placeholder with a Retry button, shared by every screen's failed query. */
export function ErrorState({
  glyph = '⚠️',
  title,
  description,
  retryLabel,
  onRetry,
}: {
  glyph?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <EmptyState
      glyph={glyph}
      title={title}
      description={description}
      action={
        <Button color="primary" fill="outline" size="middle" onClick={onRetry}>
          {retryLabel}
        </Button>
      }
    />
  );
}

/**
 * Bottom-sheet frame for the standalone modal routes (add/edit expense,
 * settlement). Renders an antd-mobile `Popup` sliding up from the bottom with
 * a grabber, a sticky `NavBar` (title + close), and a scrollable body. The
 * route stays mounted the whole time it's open; `onClose` (mask tap or the
 * close icon) navigates back.
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Popup
      visible
      position="bottom"
      closeOnMaskClick
      onMaskClick={onClose}
      onClose={onClose}
      bodyClassName="ts-sheet"
    >
      <div className="ts-sheet-grabber" />
      <NavBar className="ts-sheet-nav" backIcon={<CloseOutline />} onBack={onClose}>
        {title}
      </NavBar>
      <div className="ts-sheet-body">{children}</div>
    </Popup>
  );
}
