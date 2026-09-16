// SPEC §7: RFC 4180 field parsing and a quote-aware line splitter.
// A CSV value may contain commas, quotes and newlines, so neither splitting
// on "\n" nor splitting on "," is safe; both passes track quote state.

const BOM = "﻿";

/** Strips a UTF-8 BOM if the text starts with one. */
export function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

/**
 * Splits CSV text into lines, keeping newlines that appear inside quotes as
 * part of a single row. Handles both "\r\n" and "\n" endings.
 */
export function splitLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      // A doubled quote inside a quoted field is an escaped quote, not a
      // delimiter, so it must not flip the quote state.
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      lines.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.length > 0) lines.push(current);
  return lines;
}

/** Parses one CSV line into fields, honouring quotes and escaped quotes. */
export function parseLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  fields.push(current);
  return fields;
}

/** Maps a header row to column indexes, lower-cased and trimmed. */
export function headerIndex(headerLine: string): Record<string, number> {
  const index: Record<string, number> = {};
  parseLine(headerLine).forEach((name, i) => {
    const key = name.trim().toLowerCase();
    // First occurrence wins, so a duplicated column cannot shadow the original.
    if (!(key in index)) index[key] = i;
  });
  return index;
}

/** Returns the required columns absent from a header. */
export function missingColumns(
  index: Record<string, number>,
  required: readonly string[],
): string[] {
  return required.filter((column) => !(column in index));
}

/** Drops trailing blank lines so a trailing newline is not counted as a row. */
export function dataLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end--;
  return lines.slice(1, end);
}
