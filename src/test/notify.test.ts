import { describe, expect, it } from "vitest";
import { backoffSeconds, p95, sendNotification } from "@/lib/notify";

describe("worker policy", () => {
  it("uses exponential backoff", () => {
    expect([0, 1, 2, 3].map(backoffSeconds)).toEqual([1, 2, 4, 8]);
  });
  it("provider fails when rand < fail rate", async () => {
    await expect(sendNotification({ id: "1", kind: "k" }, () => 0)).rejects.toThrow();
    await expect(sendNotification({ id: "1", kind: "k" }, () => 0.99)).resolves.toBeUndefined();
  });
  it("computes p95", () => {
    expect(p95(Array.from({ length: 100 }, (_, i) => i + 1))).toBe(95);
    expect(p95([])).toBe(0);
  });
});
