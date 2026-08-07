import { describe, expect, it } from "vitest";

import { formatCommitDate, formatCommitDateFull } from "./commit-format";

/** Local-time Date -> unix seconds, mirroring how git reports commit dates. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) =>
  Math.floor(new Date(y, mo - 1, d, h, mi, s).getTime() / 1000);

describe("formatCommitDate", () => {
  const now = new Date(2026, 7, 7, 12, 0, 0);

  it("drops the year and keeps the clock time within the current year", () => {
    expect(formatCommitDate(at(2026, 8, 7, 10, 4, 27), now)).toBe("08-07 10:04");
  });

  it("zero-pads month, day, hour and minute", () => {
    expect(formatCommitDate(at(2026, 1, 2, 3, 4), now)).toBe("01-02 03:04");
  });

  it("keeps the year and drops the clock time for older commits", () => {
    expect(formatCommitDate(at(2025, 11, 3, 22, 15), now)).toBe("2025-11-03");
  });

  it("treats a commit from a later year as out-of-year too", () => {
    expect(formatCommitDate(at(2027, 1, 1, 0, 0), now)).toBe("2027-01-01");
  });

  it("switches form across the new-year boundary", () => {
    const lastSecondOf2025 = at(2025, 12, 31, 23, 59, 59);
    expect(formatCommitDate(lastSecondOf2025, now)).toBe("2025-12-31");
    expect(formatCommitDate(lastSecondOf2025, new Date(2025, 11, 31))).toBe("12-31 23:59");
  });

  it("handles the last day of a month", () => {
    expect(formatCommitDate(at(2026, 2, 28, 23, 59), now)).toBe("02-28 23:59");
  });

  it("defaults `now` to the current time", () => {
    const thisYear = new Date().getFullYear();
    expect(formatCommitDate(at(thisYear, 6, 15, 9, 30))).toBe("06-15 09:30");
  });
});

describe("formatCommitDateFull", () => {
  it("renders a full, zero-padded local timestamp", () => {
    expect(formatCommitDateFull(at(2026, 8, 7, 10, 4, 27))).toBe("2026-08-07 10:04:27");
    expect(formatCommitDateFull(at(2025, 1, 2, 3, 4, 5))).toBe("2025-01-02 03:04:05");
  });
});
