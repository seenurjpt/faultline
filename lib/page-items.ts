/**
 * The page numbers a pager should show, with `null` standing for a gap.
 *
 * Always includes the first and last page plus a window around the current
 * one, so the control stays about the same width whether there are 3 pages or
 * 1,556 — buttons that move under the pointer as you page through are worse
 * than a couple of extra numbers.
 */
export function pageItems(
  page: number,
  pageCount: number,
  window = 1,
): (number | null)[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  const pages = new Set<number>([1, pageCount]);
  for (let p = page - window; p <= page + window; p++) {
    if (p >= 1 && p <= pageCount) pages.add(p);
  }
  // Near the ends the window is clipped on one side, which would leave the
  // control visibly shorter; these keep it steady.
  if (page <= 3) for (const p of [2, 3, 4]) pages.add(p);
  if (page >= pageCount - 2) {
    for (const p of [pageCount - 3, pageCount - 2, pageCount - 1]) {
      if (p >= 1) pages.add(p);
    }
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const items: (number | null)[] = [];
  let previous = 0;
  for (const p of sorted) {
    // A gap of exactly one page is shown as that page, never as an ellipsis
    // that hides less than it costs.
    if (p - previous === 2) items.push(previous + 1);
    else if (p - previous > 2) items.push(null);
    items.push(p);
    previous = p;
  }
  return items;
}
