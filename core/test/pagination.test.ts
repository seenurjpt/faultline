// The logs table renders one page at a time, and a keyset cursor only points
// forward, so going back depends entirely on the trail of cursors being
// correct. These pin that arithmetic: the page the user sees, and the cursor
// used to fetch it, must never come from a different result set.
import { describe, expect, it } from "vitest";
import {
  advance,
  firstPage,
  jumpTo,
  positionFor,
  retreat,
  type PagePosition,
} from "../../lib/use-logs";
import { pageItems } from "../../lib/page-items";

const KEY = '["ds",null]';
const OTHER = '["ds","failures"]';

/** Walks forward `n` pages, as the Next button does. */
function forward(from: PagePosition, key: string, cursors: string[]): PagePosition {
  return cursors.reduce((pos, c) => advance(pos, key, c), from);
}

describe("logs pagination trail", () => {
  it("starts on page 0 with no cursor", () => {
    const p = firstPage(KEY);
    expect(p.index).toBe(0);
    expect(p.trail).toEqual([null]);
    // Page 0 must fetch without a cursor, or it would skip the first rows.
    expect(p.trail[p.index]).toBeNull();
  });

  it("remembers the cursor for each page on the way forward", () => {
    const p = forward(firstPage(KEY), KEY, ["c1", "c2", "c3"]);
    expect(p.index).toBe(3);
    expect(p.trail).toEqual([null, "c1", "c2", "c3"]);
    expect(p.trail[p.index]).toBe("c3");
  });

  it("returns to the exact cursor that produced the earlier page", () => {
    const three = forward(firstPage(KEY), KEY, ["c1", "c2", "c3"]);
    const two = retreat(three, KEY);
    const one = retreat(two, KEY);
    expect(two.trail[two.index]).toBe("c2");
    expect(one.trail[one.index]).toBe("c1");
    // Back at the start, the fetch must again carry no cursor.
    const zero = retreat(one, KEY);
    expect(zero.index).toBe(0);
    expect(zero.trail[zero.index]).toBeNull();
  });

  it("cannot retreat past the first page", () => {
    const p = retreat(retreat(firstPage(KEY), KEY), KEY);
    expect(p.index).toBe(0);
  });

  it("truncates the forward trail when stepping back then forward again", () => {
    const three = forward(firstPage(KEY), KEY, ["c1", "c2", "c3"]);
    const one = retreat(retreat(three, KEY), KEY);
    // Rows may have changed underneath, so the old page-2 cursor must not be
    // reused — the fresh one replaces it.
    const again = advance(one, KEY, "c2-fresh");
    expect(again.index).toBe(2);
    expect(again.trail).toEqual([null, "c1", "c2-fresh"]);
  });

  it("drops the trail entirely when the filters change", () => {
    const deep = forward(firstPage(KEY), KEY, ["c1", "c2", "c3"]);
    const moved = positionFor(deep, OTHER);
    expect(moved.index).toBe(0);
    expect(moved.trail).toEqual([null]);
    // A cursor from the old result set would point into the wrong rows.
    expect(moved.trail[moved.index]).toBeNull();
  });

  it("keeps the position when the key is unchanged", () => {
    const deep = forward(firstPage(KEY), KEY, ["c1", "c2"]);
    expect(positionFor(deep, KEY)).toBe(deep);
  });

  it("starts a new filter's first page even when advancing", () => {
    const deep = forward(firstPage(KEY), KEY, ["c1", "c2"]);
    const p = advance(deep, OTHER, "n1");
    expect(p.key).toBe(OTHER);
    expect(p.trail).toEqual([null, "n1"]);
    expect(p.index).toBe(1);
  });

  it("retreating under a changed key lands on the new first page", () => {
    const deep = forward(firstPage(KEY), KEY, ["c1", "c2"]);
    const p = retreat(deep, OTHER);
    expect(p.key).toBe(OTHER);
    expect(p.index).toBe(0);
    expect(p.trail).toEqual([null]);
  });

  it("never mutates the position it was given", () => {
    const p = forward(firstPage(KEY), KEY, ["c1", "c2"]);
    const snapshot = JSON.stringify(p);
    advance(p, KEY, "c3");
    retreat(p, KEY);
    positionFor(p, OTHER);
    jumpTo(p, KEY, 40);
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});

describe("jumping to a page", () => {
  it("marks a distant page as jumped, so it is fetched by offset", () => {
    const p = jumpTo(firstPage(KEY), KEY, 46);
    expect(p.index).toBe(46);
    expect(p.jumped).toBe(true);
    // No cursor exists for a page nobody walked to.
    expect(p.trail[p.index]).toBeUndefined();
  });

  it("jumping to page 1 needs no offset at all", () => {
    const deep = jumpTo(firstPage(KEY), KEY, 46);
    const home = jumpTo(deep, KEY, 0);
    expect(home.index).toBe(0);
    expect(home.jumped).toBe(false);
    expect(home.trail).toEqual([null]);
  });

  it("re-uses a known cursor instead of an offset when it has one", () => {
    const three = forward(firstPage(KEY), KEY, ["c1", "c2", "c3"]);
    const back = jumpTo(three, KEY, 2);
    expect(back.jumped).toBe(false);
    expect(back.trail[back.index]).toBe("c2");
  });

  it("steps on from a jumped page with a fresh trail", () => {
    const jumped = jumpTo(firstPage(KEY), KEY, 46);
    const next = advance(jumped, KEY, "c47");
    expect(next.index).toBe(47);
    expect(next.jumped).toBe(false);
    // The trail restarts here; earlier pages are reachable only by jumping.
    expect(next.trail[next.index]).toBe("c47");
  });

  it("steps back from a jumped page by jumping again", () => {
    const jumped = jumpTo(firstPage(KEY), KEY, 46);
    const back = retreat(jumped, KEY);
    expect(back.index).toBe(45);
    expect(back.jumped).toBe(true);
  });

  it("stepping back to page 1 from a jump drops the offset", () => {
    const jumped = jumpTo(firstPage(KEY), KEY, 1);
    const back = retreat(jumped, KEY);
    expect(back.index).toBe(0);
    expect(back.jumped).toBe(false);
  });

  it("clamps a negative target to the first page", () => {
    expect(jumpTo(firstPage(KEY), KEY, -5).index).toBe(0);
  });

  it("jumping under a changed key abandons the old trail", () => {
    const deep = forward(firstPage(KEY), KEY, ["c1", "c2", "c3"]);
    const p = jumpTo(deep, OTHER, 9);
    expect(p.key).toBe(OTHER);
    expect(p.jumped).toBe(true);
    expect(p.trail).toEqual([null]);
  });
});

describe("page number items", () => {
  it("lists every page when they all fit", () => {
    expect(pageItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageItems(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("always shows the first and last page", () => {
    for (const page of [1, 50, 156]) {
      const items = pageItems(page, 156);
      expect(items[0]).toBe(1);
      expect(items[items.length - 1]).toBe(156);
    }
  });

  it("keeps the current page in the window", () => {
    const items = pageItems(78, 156);
    expect(items).toContain(77);
    expect(items).toContain(78);
    expect(items).toContain(79);
    // Gaps on both sides rather than 156 buttons.
    expect(items.filter((i) => i === null)).toHaveLength(2);
  });

  it("never renders a gap that hides a single page", () => {
    for (let page = 1; page <= 156; page++) {
      const items = pageItems(page, 156);
      const numbers = items.filter((i): i is number => i !== null);
      for (let i = 1; i < numbers.length; i++) {
        const step = numbers[i] - numbers[i - 1];
        // A step of exactly 2 would mean one hidden page behind an ellipsis,
        // which costs more space than showing it.
        expect(step, `page ${page}: ${numbers[i - 1]} -> ${numbers[i]}`).not.toBe(2);
      }
    }
  });

  it("stays a steady width across the whole range", () => {
    const widths = new Set<number>();
    for (let page = 1; page <= 156; page++) {
      widths.add(pageItems(page, 156).length);
    }
    // One or two lengths is fine; a control that jumps between many widths
    // moves the buttons under the pointer.
    expect(widths.size).toBeLessThanOrEqual(2);
  });
});
