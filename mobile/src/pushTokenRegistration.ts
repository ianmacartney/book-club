/** One registration per user/token per app session, including concurrent mounts. */
export function createPushTokenRegistration() {
  const registrations = new Map<
    string,
    { token: string; pending: Promise<void> }
  >();
  return {
    register(
      userId: string,
      token: string,
      record: (token: string) => Promise<unknown>,
    ): Promise<void> {
      const existing = registrations.get(userId);
      if (existing?.token === token) return existing.pending;

      const entry = {
        token,
        pending: Promise.resolve()
          .then(() => record(token))
          .then(() => {}),
      };
      registrations.set(userId, entry);
      entry.pending = entry.pending.catch((err) => {
        // A failed registration must remain retryable on the next mount.
        if (registrations.get(userId) === entry) registrations.delete(userId);
        throw err;
      });
      return entry.pending;
    },
    clear() {
      registrations.clear();
    },
  };
}

// Keep successful registrations across SignedIn remounts. A new app process
// starts fresh, which also repairs tokens removed by the push service.
export const pushTokenRegistration = createPushTokenRegistration();
