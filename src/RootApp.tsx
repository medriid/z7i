'use client';

import { useEffect, useState } from 'react';
import App from './App';

export default function RootApp() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      const onLoad = () => {
        navigator.serviceWorker
          .register('/sw.js', { updateViaCache: 'none' })
          .then((registration) => {
            registration.update().catch(() => {
              // ignore update failures; runtime will continue with existing worker
            });

            registration.addEventListener('updatefound', () => {
              const installingWorker = registration.installing;
              if (!installingWorker) return;

              installingWorker.addEventListener('statechange', () => {
                if (
                  installingWorker.state === 'installed' &&
                  navigator.serviceWorker.controller
                ) {
                  installingWorker.postMessage({ type: 'SKIP_WAITING' });
                }
              });
            });
          })
          .catch((error) => {
            console.error('Service worker registration failed:', error);
          });
      };

      let hasRefreshed = false;
      const onControllerChange = () => {
        if (hasRefreshed) return;
        hasRefreshed = true;
        window.location.reload();
      };

      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      window.addEventListener('load', onLoad, { once: true });

      return () => {
        navigator.serviceWorker.removeEventListener(
          'controllerchange',
          onControllerChange
        );
        window.removeEventListener('load', onLoad);
      };
    }
  }, []);

  if (!mounted) return null;

  return <App />;
}
