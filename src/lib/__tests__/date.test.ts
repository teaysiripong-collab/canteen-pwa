import { describe, expect, it } from "vitest";
import { addDays, daysBetween, todayIso } from "../date";

describe("business dates", () => {
  it("uses the Bangkok day, not the server's UTC day", () => {
    // 17:30 UTC is already the next day in Bangkok (UTC+7). Reading the UTC date here
    // would expire food a shift early and file night-shift movements on the wrong day.
    expect(todayIso(new Date("2026-08-13T17:30:00Z"))).toBe("2026-08-14");
    expect(todayIso(new Date("2026-08-13T16:59:00Z"))).toBe("2026-08-13");
  });

  it("keeps the date stable in the middle of the working day", () => {
    expect(todayIso(new Date("2026-08-13T03:00:00Z"))).toBe("2026-08-13");
  });

  it("adds and subtracts whole days across month boundaries", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-08-13", 0)).toBe("2026-08-13");
  });

  it("counts days forwards and backwards", () => {
    expect(daysBetween("2026-08-13", "2026-08-20")).toBe(7);
    expect(daysBetween("2026-08-13", "2026-08-13")).toBe(0);
    expect(daysBetween("2026-08-13", "2026-08-10")).toBe(-3);
  });
});
