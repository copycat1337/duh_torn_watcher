// Simple wrapper for routing runtime messages between popup <-> content.
//
// Returns an unsubscribe function so callers can clean up on stop()/re-init.
// Each registration gets its own unique token so that, if several listeners
// are registered for the same `type`, only the first one to answer wins and
// the others do not throw "message port closed".

let __msgSeq = 0;

export const onMessage = (type, handler) => {
  if (typeof type !== 'string' || !type) {
    throw new TypeError('onMessage: type must be a non-empty string');
  }
  if (typeof handler !== 'function') {
    throw new TypeError('onMessage: handler must be a function');
  }

  const token = ++__msgSeq;

  // Track which message tokens have already been answered, per message,
  // so a second listener for the same type does not try to double-respond.
  const answered = new WeakSet();

  const listener = (msg, sender, sendResponse) => {
    if (!msg || msg.type !== type) return;

    // If another listener already took this message, stay out of it.
    if (answered.has(msg)) return;
    answered.add(msg);

    let responded = false;
    const safeRespond = (payload) => {
      if (responded) return;
      responded = true;
      try {
        // Accessing lastError clears it and prevents "Unchecked runtime.lastError".
        void chrome.runtime.lastError;
        sendResponse(payload);
      } catch (e) {
        // Port already closed (sender gone). Nothing we can do; don't throw.
        console.warn(`[messages] sendResponse failed for "${type}" (listener #${token}):`, e?.message || e);
      }
    };

    try {
      Promise.resolve(handler(msg, sender))
        .then((r) => safeRespond(r ?? { ok: true }))
        .catch((e) => safeRespond({ ok: false, error: e?.message || String(e) }));
    } catch (e) {
      // Handler threw synchronously before returning a promise.
      safeRespond({ ok: false, error: e?.message || String(e) });
    }

    return true; // keep channel open for async sendResponse
  };

  try {
    chrome.runtime.onMessage.addListener(listener);
  } catch (e) {
    console.warn(`[messages] failed to register listener for "${type}":`, e?.message || e);
    return () => {};
  }

  return function unsubscribe() {
    try {
      chrome.runtime.onMessage.removeListener(listener);
    } catch (e) {
      console.warn(`[messages] failed to remove listener for "${type}":`, e?.message || e);
    }
  };
};