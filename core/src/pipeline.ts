// SPEC §6.3: one chunk in, cleaned checks plus rejections out, with the
// per-chunk invariant rowsIn = stored + mergedInChunk + rejected
// (mergedAcrossChunks is only knowable once the database has seen the row).
import { clean, createContext } from "./clean";
import { dataLines, headerIndex, parseLine, splitLines, stripBom } from "./csv";
import { mergeWithinChunk } from "./merge";
import type {
  CleanCheck,
  IssueCounts,
  ProcessedChunk,
  Rejection,
} from "./types";

function countIssues(checks: CleanCheck[]): IssueCounts {
  const issues: IssueCounts = {};
  for (const check of checks) {
    for (const flag of check.flags) {
      issues[flag] = (issues[flag] ?? 0) + 1;
    }
  }
  return issues;
}

/**
 * Processes one chunk of CSV text. The text carries its own header line so a
 * chunk is self-describing; `lineOffset` is the file line number of the
 * chunk's first data row, which keeps `source_line` pointing at the real file.
 */
export function processChunk(
  csvText: string,
  lineOffset: number,
  now?: () => number,
): ProcessedChunk {
  const lines = splitLines(stripBom(csvText));
  if (lines.length === 0) {
    return {
      checks: [],
      rejections: [],
      counts: { rowsIn: 0, stored: 0, mergedInChunk: 0, rejected: 0 },
      issues: {},
    };
  }

  const index = headerIndex(lines[0]);
  const headerLength = parseLine(lines[0]).length;
  const rows = dataLines(lines);
  const ctx = createContext(now);

  const checks: CleanCheck[] = [];
  const rejections: Rejection[] = [];

  rows.forEach((line, i) => {
    const lineNumber = lineOffset + i;
    // A blank line inside the body is not a row; skip without rejecting.
    if (line.trim() === "") return;

    const result = clean(parseLine(line), index, lineNumber, ctx, headerLength);
    if (result.kind === "check") {
      checks.push(result.check);
    } else {
      rejections.push({ lineNumber, reason: result.reason, rawLine: line });
    }
  });

  const rowsIn = checks.length + rejections.length;
  const { merged, mergedInChunk } = mergeWithinChunk(checks);

  return {
    checks: merged,
    rejections,
    counts: {
      rowsIn,
      stored: merged.length,
      mergedInChunk,
      rejected: rejections.length,
    },
    issues: countIssues(merged),
  };
}

/** Sums issue maps from several chunks. */
export function sumIssues(parts: IssueCounts[]): IssueCounts {
  const total: IssueCounts = {};
  for (const part of parts) {
    for (const [flag, count] of Object.entries(part)) {
      const key = flag as keyof IssueCounts;
      total[key] = (total[key] ?? 0) + (count ?? 0);
    }
  }
  return total;
}
