import { createMugModule } from './mug.js';

export function init({ getConfig }) {
  const module = createMugModule({ getConfig });

  // Note: The mug config path is 'notifications.mug.enabled'
  const isEnabled = () => !!getConfig('notifications.mug.enabled');

  function start() {
    if (!isEnabled()) return;
    module.start();
  }

  function stop() {
    module.stop();
  }

  return {
    name: 'mug-watch',

    sync() {
      if (isEnabled()) {
        module.start(); 
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