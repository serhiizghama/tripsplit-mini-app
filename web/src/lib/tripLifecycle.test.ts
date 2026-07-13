import { describe, expect, it } from 'vitest';

import { finishTripConfirmMessage } from './tripLifecycle';
import { createTranslator } from '../i18n/t';
import en from '../i18n/en.json';

const t = createTranslator('en', en);

describe('finishTripConfirmMessage', () => {
  it('warns about unsettled debts when transfers are still outstanding', () => {
    expect(finishTripConfirmMessage(t, true)).toBe(
      en['settings.finishTripConfirmOutstanding'],
    );
  });

  it('uses the plain confirm copy when everything is already settled', () => {
    expect(finishTripConfirmMessage(t, false)).toBe(en['settings.finishTripConfirm']);
  });
});
