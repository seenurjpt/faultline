"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Incident, Ribbon, Tz } from "@/lib/types";
import {
  formatDayMonth,
  formatTime,
  formatDuration,
  tzLabel,
} from "@/lib/format";
import { cx } from "../ui/primitives";

// DESIGN §6.3 geometry.
const LANE_HEIGHT = 44;
const LANE_GAP = 8;
const LABEL_WIDTH = 128;
const AXIS_HEIGHT = 24;
const SLOT_MS = 15 * 60_000;

type HoverState = {
  laneIndex: number;
  slotIndex: number;
  x: number;
  y: number;
} | null;

function cssVar(el: HTMLElement, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** DESIGN §6.3: tick height follows how slow the service was at that moment. */
function downHeight(ratio: number | null): number {
  const r = ratio ?? 1;
  return Math.min(40, Math.max(16, 8 * r));
}

export function FaultRibbon({
  ribbon,
  incidents,
  tz,
  onSelect,
  highlightIncident,
}: {
  ribbon: Ribbon;
  incidents: Incident[];
  tz: Tz;
  onSelect: (serviceId: string, utcDay: string) => void;
  highlightIncident: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(0);
  const [hover, setHover] = useState<HoverState>(null);
  // Keyboard model: a day cursor per lane (§6.3).
  const [cursor, setCursor] = useState<{ lane: number; day: number } | null>(
    null,
  );

  const start = useMemo(() => new Date(ribbon.start).getTime(), [ribbon.start]);
  const slotCount = ribbon.services[0]?.states.length ?? 0;
  const lanes = ribbon.services;
  const totalHeight = lanes.length * (LANE_HEIGHT + LANE_GAP);

  const slotsPerDay = (24 * 60) / ribbon.slotMinutes;
  const dayCount = Math.ceil(slotCount / slotsPerDay);

  // Measure the plot area; the ribbon redraws at device pixel resolution.
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setPlotWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setPlotWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const slotWidth = plotWidth > 0 && slotCount > 0 ? plotWidth / slotCount : 0;

  // ---- Canvas draw -------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || plotWidth === 0 || slotCount === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(plotWidth * dpr);
    canvas.height = Math.floor(totalHeight * dpr);
    canvas.style.width = `${plotWidth}px`;
    canvas.style.height = `${totalHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, plotWidth, totalHeight);

    const root = document.documentElement;
    const colors = {
      rule: cssVar(root, "--rule"),
      calm: cssVar(root, "--calm"),
      ochre: cssVar(root, "--ochre"),
      fault: cssVar(root, "--fault"),
      void: cssVar(root, "--void"),
      shale: cssVar(root, "--shale"),
    };

    // Day gridlines at 40% opacity, month boundaries solid (§6.3).
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = colors.rule;
    for (let d = 0; d <= dayCount; d++) {
      const x = Math.round(d * slotsPerDay * slotWidth);
      ctx.fillRect(x, 0, 1, totalHeight);
    }
    ctx.restore();

    ctx.fillStyle = colors.shale;
    for (let d = 0; d <= dayCount; d++) {
      const at = new Date(start + d * slotsPerDay * SLOT_MS);
      if (at.getUTCDate() === 1) {
        ctx.fillRect(
          Math.round(d * slotsPerDay * slotWidth),
          0,
          1,
          totalHeight,
        );
      }
    }

    // One seismograph trace per lane.
    lanes.forEach((lane, laneIndex) => {
      const top = laneIndex * (LANE_HEIGHT + LANE_GAP);
      const mid = top + LANE_HEIGHT / 2;

      ctx.fillStyle = colors.rule;
      ctx.fillRect(0, Math.round(mid), plotWidth, 1);

      // Down ticks are at least 2 device pixels wide so single failures survive.
      const minWidth = 2 / dpr;
      const tickWidth = Math.max(slotWidth * 0.7, minWidth);
      // Healthy ticks need a clear gap to read as ticks. When a slot is
      // narrower than that, we draw one tick per device pixel column and let
      // the rest merge, as DESIGN §6.3 allows.
      const upPitch = 2 / dpr;
      let lastUpX = -Infinity;

      for (let i = 0; i < lane.states.length; i++) {
        const state = lane.states[i];
        const x = i * slotWidth;
        const ratio = lane.latencyRatio[i];

        if (state === ".") {
          // Unknown: a hatch block, never a gap that reads as healthy.
          ctx.save();
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = colors.void;
          for (let y = top + 8; y < top + LANE_HEIGHT - 8; y += 4) {
            ctx.fillRect(x, y, Math.max(slotWidth, minWidth), 2);
          }
          ctx.restore();
          continue;
        }

        if (state === "d") {
          const h = downHeight(ratio);
          ctx.fillStyle = colors.fault;
          ctx.fillRect(x, mid - h / 2, tickWidth, h);
          continue;
        }

        // Up, with slow checks picked out in ochre (§6.3). Healthy ticks are
        // never widened to a 1px floor: at 30 days a slot is under a pixel, and
        // padding every tick would merge the trace into a solid bar instead of
        // the even ticks the ribbon is meant to read as.
        const slow = ratio !== null && ratio > 2;
        if (slow) {
          // Slow checks always draw: they are a signal, not background.
          ctx.fillStyle = colors.ochre;
          ctx.fillRect(x, mid - 5, Math.max(slotWidth * 0.7, minWidth), 10);
          lastUpX = x;
          continue;
        }
        if (x - lastUpX < upPitch) continue;
        ctx.fillStyle = colors.calm;
        ctx.fillRect(
          Math.round(x * dpr) / dpr,
          mid - 3,
          Math.max(slotWidth * 0.55, 1 / dpr),
          6,
        );
        lastUpX = x;
      }
    });
  }, [
    plotWidth,
    slotCount,
    slotWidth,
    totalHeight,
    lanes,
    dayCount,
    slotsPerDay,
    start,
  ]);

  // ---- Interaction -------------------------------------------------------
  const utcDayFor = useCallback(
    (slotIndex: number) => {
      const d = new Date(start + slotIndex * SLOT_MS);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    },
    [start],
  );

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const laneIndex = Math.floor(y / (LANE_HEIGHT + LANE_GAP));
    const slotIndex = Math.floor(x / slotWidth);
    if (
      laneIndex < 0 ||
      laneIndex >= lanes.length ||
      slotIndex < 0 ||
      slotIndex >= slotCount
    ) {
      setHover(null);
      return;
    }
    setHover({ laneIndex, slotIndex, x, y });
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const laneIndex = Math.floor(y / (LANE_HEIGHT + LANE_GAP));
    const slotIndex = Math.floor(x / slotWidth);
    if (laneIndex < 0 || laneIndex >= lanes.length) return;
    onSelect(lanes[laneIndex].serviceId, utcDayFor(slotIndex));
  };

  const laneKeyDown = (e: React.KeyboardEvent, laneIndex: number) => {
    const day = cursor?.lane === laneIndex ? cursor.day : 0;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = Math.min(
        dayCount - 1,
        Math.max(0, day + (e.key === "ArrowRight" ? 1 : -1)),
      );
      setCursor({ lane: laneIndex, day: next });
    } else if (e.key === "Enter") {
      e.preventDefault();
      onSelect(
        lanes[laneIndex].serviceId,
        utcDayFor(Math.round(day * slotsPerDay)),
      );
    } else if (e.key === "Escape") {
      setCursor(null);
    }
  };

  // ---- Derived overlays --------------------------------------------------
  const laneIncidents = useMemo(() => {
    return lanes.map((lane) =>
      incidents
        .filter((i) => i.serviceId === lane.serviceId)
        .map((i) => {
          const from = (new Date(i.start).getTime() - start) / SLOT_MS;
          const to = (new Date(i.end).getTime() - start) / SLOT_MS;
          return { incident: i, from, to };
        })
        .filter((b) => b.to > 0 && b.from < slotCount),
    );
  }, [lanes, incidents, start, slotCount]);

  const hoverInfo = useMemo(() => {
    if (!hover) return null;
    const lane = lanes[hover.laneIndex];
    const state = lane.states[hover.slotIndex];
    const ratio = lane.latencyRatio[hover.slotIndex];
    const at = new Date(start + hover.slotIndex * SLOT_MS);
    return { lane, state, ratio, at };
  }, [hover, lanes, start]);

  // Axis labels thinned to fit: every day up to 14, every third beyond.
  const axisStep = dayCount <= 14 ? 1 : 3;

  const perDayCounts = useMemo(() => {
    return lanes.map((lane) => {
      const days: { down: number; unknown: number }[] = [];
      for (let d = 0; d < dayCount; d++) {
        let down = 0;
        let unknown = 0;
        for (let i = d * slotsPerDay; i < (d + 1) * slotsPerDay; i++) {
          const s = lane.states[i];
          if (s === "d") down++;
          else if (s === ".") unknown++;
        }
        days.push({ down, unknown });
      }
      return days;
    });
  }, [lanes, dayCount, slotsPerDay]);

  return (
    <div className="w-full min-w-0">
      {/* Under 720px the lanes scroll with the label column pinned (§5.4). */}
      <div className="w-full min-w-0 overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="flex">
            {/* Service labels */}
            <div
              className="shrink-0 sticky left-0 z-10 bg-[var(--paper)]"
              style={{ width: LABEL_WIDTH }}
            >
              {lanes.map((lane) => (
                <div
                  key={lane.serviceId}
                  className="flex items-center text-[13px] leading-[18px] font-medium pr-3"
                  style={{ height: LANE_HEIGHT, marginBottom: LANE_GAP }}
                >
                  {lane.serviceName}
                </div>
              ))}
            </div>

            {/* Plot: canvas with SVG overlays on top */}
            <div
              ref={plotRef}
              className="relative flex-1 cursor-crosshair"
              style={{ height: totalHeight }}
              onMouseMove={handleMove}
              onMouseLeave={() => setHover(null)}
              onClick={handleClick}
            >
              <canvas ref={canvasRef} className="absolute inset-0 block" />

              <svg
                className="absolute inset-0 pointer-events-none"
                width={plotWidth}
                height={totalHeight}
                aria-hidden="true"
              >
                {laneIncidents.map((bands, laneIndex) =>
                  bands.map(({ incident, from, to }) => {
                    const top = laneIndex * (LANE_HEIGHT + LANE_GAP);
                    const x = from * slotWidth;
                    const w = Math.max((to - from) * slotWidth, 2);
                    const key = `${incident.serviceId}-${incident.start}`;
                    const active = highlightIncident === key;
                    return incident.confirmed ? (
                      <g key={key}>
                        <rect
                          x={x}
                          y={top}
                          width={w}
                          height={LANE_HEIGHT}
                          fill="var(--fault-wash)"
                          opacity={active ? 2 : 1}
                          className="transition-opacity duration-[120ms]"
                        />
                        {active && (
                          <rect
                            x={x}
                            y={top}
                            width={w}
                            height={LANE_HEIGHT}
                            fill="none"
                            stroke="var(--fault)"
                            strokeWidth={1}
                          />
                        )}
                        <text
                          x={x + w / 2}
                          y={top + 9}
                          textAnchor="middle"
                          className="fill-[var(--shale)] text-[12px]"
                        >
                          {formatDuration(incident.durationMinutes)}
                        </text>
                      </g>
                    ) : (
                      // Unconfirmed cluster: a dotted underline, never a band.
                      <line
                        key={key}
                        x1={x}
                        x2={x + w}
                        y1={top + LANE_HEIGHT - 1}
                        y2={top + LANE_HEIGHT - 1}
                        stroke="var(--ochre)"
                        strokeWidth={2}
                        strokeDasharray="2 2"
                      />
                    );
                  }),
                )}

                {hover && (
                  <line
                    x1={hover.slotIndex * slotWidth}
                    x2={hover.slotIndex * slotWidth}
                    y1={0}
                    y2={totalHeight}
                    stroke="var(--basalt)"
                    strokeOpacity={0.3}
                    strokeWidth={1}
                  />
                )}

                {cursor && (
                  <rect
                    x={cursor.day * slotsPerDay * slotWidth}
                    y={cursor.lane * (LANE_HEIGHT + LANE_GAP)}
                    width={Math.max(slotsPerDay * slotWidth, 2)}
                    height={LANE_HEIGHT}
                    fill="none"
                    stroke="var(--tide)"
                    strokeWidth={2}
                  />
                )}
              </svg>

              {/* Focusable lane groups carry the keyboard model (§6.3). */}
              <div className="absolute inset-0">
                {lanes.map((lane, laneIndex) => {
                  const down = [...lane.states].filter((s) => s === "d").length;
                  const inc = incidents.filter(
                    (i) => i.serviceId === lane.serviceId && i.confirmed,
                  ).length;
                  return (
                    <div
                      key={lane.serviceId}
                      role="group"
                      tabIndex={0}
                      aria-label={`${lane.serviceName}: ${down} failed ${
                        down === 1 ? "slot" : "slots"
                      }, ${inc} ${inc === 1 ? "incident" : "incidents"}`}
                      onKeyDown={(e) => laneKeyDown(e, laneIndex)}
                      className="absolute left-0 right-0"
                      style={{
                        top: laneIndex * (LANE_HEIGHT + LANE_GAP),
                        height: LANE_HEIGHT,
                      }}
                    />
                  );
                })}
              </div>

              {/* Tooltip follows the crosshair (§6.3). */}
              {hover && hoverInfo && (
                <div
                  className="pointer-events-none absolute z-20 rounded-[var(--radius-field)] border border-[var(--rule)] bg-[var(--paper)] px-3 py-2 text-[13px] leading-[18px]"
                  style={{
                    left: Math.min(hover.x + 12, Math.max(plotWidth - 210, 0)),
                    top: Math.max(hover.y - 76, 0),
                    width: 200,
                  }}
                >
                  <div className="font-medium">
                    {hoverInfo.lane.serviceName}
                  </div>
                  <div className="text-[var(--shale)]">
                    {formatDayMonth(hoverInfo.at, tz)}{" "}
                    {new Date(hoverInfo.at).getUTCFullYear()},{" "}
                    {formatTime(hoverInfo.at, tz)} {tzLabel(tz)}
                  </div>
                  <div
                    className={cx(
                      hoverInfo.state === "d" && "text-[var(--fault)]",
                    )}
                  >
                    {hoverInfo.state === "d"
                      ? "Failed"
                      : hoverInfo.state === "."
                        ? "No data"
                        : "Healthy"}
                  </div>
                  {hoverInfo.ratio !== null && (
                    <div className="text-[var(--shale)]">
                      Latency {hoverInfo.ratio.toFixed(1)}× normal
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Axis */}
          <div className="flex" style={{ height: AXIS_HEIGHT }}>
            <div className="shrink-0" style={{ width: LABEL_WIDTH }} />
            <div className="relative flex-1">
              {Array.from({ length: dayCount }).map((_, d) => {
                if (d % axisStep !== 0) return null;
                const at = new Date(start + d * slotsPerDay * SLOT_MS);
                const firstOfMonth = d === 0 || at.getUTCDate() === 1;
                return (
                  <span
                    key={d}
                    className="absolute top-1 text-[12px] leading-[16px] text-[var(--shale)] tnum"
                    style={{ left: d * slotsPerDay * slotWidth }}
                  >
                    {firstOfMonth ? formatDayMonth(at) : at.getUTCDate()}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <Legend />

      {/* DESIGN §6.3 / §8: the same data as a table, for screen readers. */}
      <div className="sr-only-wrap">
        <table>
          <caption>Failed and missing slots per service per day</caption>
          <thead>
            <tr>
              <th scope="col">Service</th>
              {Array.from({ length: dayCount }).map((_, d) => (
                <th key={d} scope="col">
                  {formatDayMonth(new Date(start + d * slotsPerDay * SLOT_MS))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lanes.map((lane, laneIndex) => (
              <tr key={lane.serviceId}>
                <th scope="row">{lane.serviceName}</th>
                {perDayCounts[laneIndex].map((day, d) => (
                  <td key={d}>
                    {day.down} failed, {day.unknown} without data
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Legend() {
  const items = [
    {
      label: "Healthy",
      mark: <span className="block h-[6px] w-[3px] bg-[var(--calm)]" />,
    },
    {
      label: "Failed",
      mark: <span className="block h-[16px] w-[3px] bg-[var(--fault)]" />,
    },
    {
      label: "Incident",
      mark: (
        <span className="block h-[14px] w-5 bg-[var(--fault-wash)] border border-[var(--fault)]" />
      ),
    },
    {
      label: "Failure cluster without latency spike",
      mark: (
        <span className="block h-0 w-5 border-b-2 border-dotted border-[var(--ochre)]" />
      ),
    },
    {
      label: "No data",
      mark: (
        <span
          className="block h-[14px] w-5"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, var(--void) 0 2px, transparent 2px 4px)",
          }}
        />
      ),
    },
  ];

  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] leading-[16px] text-[var(--shale)]">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span className="flex h-4 w-5 items-center justify-center">
            {item.mark}
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}
