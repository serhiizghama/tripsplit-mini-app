import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';

import './index.css';
import App from './App.tsx';
import { queryClient } from './api/queryClient';
import { ActiveTripProvider } from './components/ActiveTripProvider';
import { LocaleProvider } from './i18n';
import { bootTelegramSdk } from './telegram/bootstrap';
import { maybeLoadEruda } from './eruda.ts';

void maybeLoadEruda();

// Runs before the first render: init the Telegram SDK, expand the
// viewport, disable vertical swipes, and force the light chrome (Phase
// 2.1). Guarded internally — never throws, even outside Telegram.
bootTelegramSdk();

// antd-mobile (mobile.ant.design) is the UI layer: importing any of its
// components pulls in `antd-mobile/es/global/global.css` (theme `--adm-*`
// variables + reset) automatically, so there's no explicit stylesheet import
// here. Brand-token overrides live in `index.css`.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <ActiveTripProvider>
          <App />
        </ActiveTripProvider>
      </LocaleProvider>
    </QueryClientProvider>
  </StrictMode>,
);
