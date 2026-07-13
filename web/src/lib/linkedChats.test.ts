import { describe, expect, it } from 'vitest';

import { linkedChatLabel } from './linkedChats';
import { createTranslator } from '../i18n/t';
import en from '../i18n/en.json';

const t = createTranslator('en', en);

describe('linkedChatLabel', () => {
  it('uses the chat title when Telegram provided one', () => {
    expect(linkedChatLabel({ chatId: -100123, title: 'Bali Crew' }, t)).toBe('Bali Crew');
  });

  it('falls back to the generic label when the title is null', () => {
    expect(linkedChatLabel({ chatId: -100123, title: null }, t)).toBe(en['settings.groupNudgesChatFallback']);
  });
});
