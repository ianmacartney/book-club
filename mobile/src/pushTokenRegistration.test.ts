import { describe, expect, test, vi } from "vitest";
import { createPushTokenRegistration } from "./pushTokenRegistration";

describe("push token registration", () => {
  test("concurrent and repeated screen mounts record the same token once", async () => {
    const cache = createPushTokenRegistration();
    const record = vi.fn().mockResolvedValue(null);
    await Promise.all([
      cache.register("peter", "token-1", record),
      cache.register("peter", "token-1", record),
    ]);
    await cache.register("peter", "token-1", record);
    expect(record).toHaveBeenCalledTimes(1);
  });

  test("rotation, switching accounts, and signing back in register again", async () => {
    const cache = createPushTokenRegistration();
    const record = vi.fn().mockResolvedValue(null);
    await cache.register("peter", "token-1", record);
    await cache.register("peter", "token-2", record);
    await cache.register("tucker", "token-2", record);
    cache.clear();
    await cache.register("peter", "token-2", record);
    expect(record.mock.calls).toEqual([
      ["token-1"],
      ["token-2"],
      ["token-2"],
      ["token-2"],
    ]);
  });

  test("an offline registration can be retried", async () => {
    const cache = createPushTokenRegistration();
    const record = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(null);
    await expect(cache.register("peter", "token-1", record)).rejects.toThrow(
      "offline",
    );
    await cache.register("peter", "token-1", record);
    expect(record).toHaveBeenCalledTimes(2);
  });
});
