"use client";

import type { Incident, Tz } from "@/lib/types";
import {
  formatDuration,
  formatNumber,
  formatTime,
  formatWeekdayDate,
  tzLabel,
} from "@/lib/format";

export function IncidentsList({
  incidents,
  periodLabel,
  tz,
  onHover,
  onSelect,
}: {
  incidents: Incident[];
  periodLabel: string;
  tz: Tz;
  onHover: (key: string | null) => void;
  onSelect: (incident: Incident) => void;
}) {
  // SPEC §9: only confirmed incidents are listed; unconfirmed clusters stay
  // in the ribbon.
  const confirmed = incidents.filter((i) => i.confirmed);

  if (confirmed.length === 0) {
    return (
      <p className="text-[13px] leading-[18px] text-[var(--shale)]">
        No incidents in {periodLabel}. Scattered single failures still count
        toward availability.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {confirmed.map((incident) => {
        const key = `${incident.serviceId}-${incident.start}`;
        return (
          <li key={key}>
            <button
              type="button"
              onMouseEnter={() => onHover(key)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(key)}
              onBlur={() => onHover(null)}
              onClick={() => onSelect(incident)}
              className="w-full border-l-[3px] border-[var(--fault)] pl-3 text-left hover:bg-[var(--fog)]"
            >
              <span className="block text-[15px] leading-[22px] font-semibold">
                {incident.serviceName}
              </span>
              <span className="block text-[13px] leading-[18px] tnum">
                {formatWeekdayDate(incident.start, tz)},{" "}
                {formatTime(incident.start, tz)}–{formatTime(incident.end, tz)}{" "}
                {tzLabel(tz)}
              </span>
              <span className="block text-[13px] leading-[18px] text-[var(--shale)]">
                {formatDuration(incident.durationMinutes)},{" "}
                {formatNumber(incident.downSlots)} failed checks,{" "}
                {formatNumber(incident.healthySlotsInside)} recoveries in
                between, latency {incident.latencyRatio.toFixed(1)}× normal
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
