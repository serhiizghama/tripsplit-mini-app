import { describe, expect, it } from 'vitest';

import { exportSuccessMessage } from './exportSummary';
import { createTranslator } from '../i18n/t';
import en from '../i18n/en.json';

const t = createTranslator('en', en);

describe('exportSuccessMessage', () => {
  it('picks the group-chat copy when delivered to a linked group', () => {
    expect(exportSuccessMessage(t, { delivered: 'group' })).toBe(
      en['balance.exportSuccessGroup'],
    );
  });

  it('picks the DM copy when delivered to the bot chat', () => {
    expect(exportSuccessMessage(t, { delivered: 'dm' })).toBe(
      en['balance.exportSuccessDm'],
    );
  });
});
