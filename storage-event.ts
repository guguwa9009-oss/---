/**
 * Minimal event bus to notify HomeScreen when photos are deleted
 * from any sub-screen, so storage stats refresh automatically.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export const storageEvent = {
  emit() {
    listeners.forEach((fn) => fn());
  },
  on(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
