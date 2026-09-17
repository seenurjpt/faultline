// Display rules that have each been wrong once: an exclusive range end shown
// as an inclusive one, and counts of one rendered with a plural noun.
import { describe, expect, it } from "vitest";
import { formatRange, issueLabel } from "../../lib/format";

describe("formatRange", () => {
  // `range_end` is stored exclusive: the Worker records
  // date_trunc('day', max(checked_at)) + 1 day. Printing it raw named a day
  // the file has no data for.
  it("shows the last day covered, not the exclusive end", () => {
    // 9-day file: 8 May through 16 May inclusive, stored as ending 17 May.
    expect(
      formatRange("2025-05-08T00:00:00.000Z", "2025-05-17T00:00:00.000Z"),
    ).toBe("8 May–16 May 2025");
  });

  it("handles a single-day file", () => {
    // One day of data reads as that day at both ends, not as two days.
    expect(
      formatRange("2025-05-08T00:00:00.000Z", "2025-05-09T00:00:00.000Z"),
    ).toBe("8 May–8 May 2025");
  });

  it("keeps the year on the left when the range crosses one", () => {
    expect(
      formatRange("2024-12-30T00:00:00.000Z", "2025-01-02T00:00:00.000Z"),
    ).toBe("30 Dec 2024–1 Jan 2025");
  });

  it("does not claim two years for a file ending on 31 December", () => {
    // Exclusive end is 1 Jan, but the data stops on 31 Dec, so the left side
    // keeps its short form rather than being expanded with a year.
    expect(
      formatRange("2025-12-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
    ).toBe("1 Dec–31 Dec 2025");
  });
});

describe("issueLabel", () => {
  it("uses a singular noun for a count of one", () => {
    expect(issueLabel("latency_unit_seconds", 1)).toBe(
      "1 latency converted from seconds",
    );
    expect(issueLabel("ts_epoch_converted", 1)).toBe(
      "1 epoch timestamp converted",
    );
    expect(issueLabel("merged_duplicate", 1)).toBe(
      "1 check absorbed a duplicate",
    );
  });

  it("uses a plural noun otherwise", () => {
    expect(issueLabel("latency_unit_seconds", 935)).toBe(
      "935 latencies converted from seconds",
    );
    expect(issueLabel("merged_duplicate", 7)).toBe(
      "7 checks absorbed a duplicate",
    );
  });

  it("degrades to readable words for an unmapped flag", () => {
    // Better than leaking a raw identifier if a flag is added without a label.
    expect(issueLabel("some_new_flag", 3)).toBe("3 some new flag");
  });
});
