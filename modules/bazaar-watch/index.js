import { createBazaarModule } from './bazaar.js';

export function init({ getConfig }) {
  const module = createBazaarModule({ getConfig });

  const isEnabled = () => !!getConfig('notifications.bazaar.enabled');

  function start() {
    if (!isEnabled()) return;
    module.start();
  }

  function stop() {
    module.stop();
  }

  return {
    name: 'bazaar-watch',

    // Idempotent: safe to call on every config save.
    sync() {
      if (isEnabled()) {
        module.start();   // start() clears any existing interval
        module.check(true);
      } else {
        module.stop();
      }
    },

    start,
    stop,
    check: (force = false) => module.check(force),
    isEnabled,
  };
}

export default { init };