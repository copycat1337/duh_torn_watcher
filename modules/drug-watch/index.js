import { createDrugModule } from './drug.js';

export function init({ getConfig }) {
  const module = createDrugModule({ getConfig });

  const isEnabled = () => !!getConfig('notifications.xanax-watch.enabled');

  function start() {
    if (!isEnabled()) return;
    module.start();
  }

  function stop() {
    module.stop();
  }

  return {
    name: 'drug-watch',

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