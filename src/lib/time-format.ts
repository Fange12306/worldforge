/**
 * Shared timeline time-point formatting.
 * Uses unit keys (not names) to produce language-appropriate output.
 */
import type { Language } from "./i18n";

export interface TU {
  key: string;
  name: string;
  digits: number;
}

// ── Helpers ──────────────────────────────────────────

export function segs(tp: string): number[] {
  return tp.split("-").map((s) => parseInt(s, 10) || 0);
}

function ordinal(n: number): string {
  const s = n % 100;
  if (s >= 11 && s <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

function monthName(month: number): string {
  const date = new Date(2000, month - 1, 1);
  return date.toLocaleString("en-US", { month: "long" });
}

// ── Unit-label formatters ────────────────────────────

/** Era label: "3纪元" / "3rd Era" */
export function formatEraLabel(value: number, lang: Language): string {
  if (lang === "en") return `${value}${ordinal(value)} Era`;
  return `${value}纪元`;
}

/** Year label: "330年" / "Year 330" */
export function formatYearLabel(value: number, lang: Language): string {
  if (lang === "en") return `Year ${value}`;
  return `${value}年`;
}

/** Month label: "3月" / "March" */
export function formatMonthLabel(value: number, lang: Language): string {
  if (lang === "en") return monthName(value);
  return `${value}月`;
}

/** Day label: "15日" / "15th" */
export function formatDayLabel(value: number, lang: Language): string {
  if (lang === "en") return `${value}${ordinal(value)}`;
  return `${value}日`;
}

/** Hour label (standalone, single time unit): "8时" / "8 o'clock" */
export function formatHourLabel(value: number, lang: Language): string {
  if (lang === "en") return `${value} o'clock`;
  return `${value}时`;
}

// ── Composite formatters ─────────────────────────────

/**
 * Leaf event label shown in the timeline tree.
 * Shows month+day+time portions (era/year are already in tree grouping nodes).
 */
export function formatLeafLabel(
  tp: string,
  units: TU[],
  precision: number | null | undefined,
  lang: Language,
): string {
  const s = segs(tp);
  const maxIdx = precision != null ? precision : units.length - 1;
  const mi = units.findIndex((x) => x.key === "month");
  const di = units.findIndex((x) => x.key === "day");

  // --- Date portion (month + day) ---
  const dateParts: string[] = [];
  if (mi >= 0 && mi <= maxIdx) {
    const v = s[mi + 1] || 0;
    if (v > 0) dateParts.push(formatMonthLabel(v, lang));
  }
  if (di >= 0 && di <= maxIdx) {
    const v = s[di + 1] || 0;
    if (v > 0) dateParts.push(formatDayLabel(v, lang));
  }

  // --- Time portion (hour, minute, second) ---
  const timeStart = Math.max(di, mi) + 1;
  const timeUnits: { val: string; key: string }[] = [];
  for (let i = timeStart; i < units.length && i <= maxIdx; i++) {
    timeUnits.push({
      val: String(s[i + 1] || 0).padStart(units[i].digits, "0"),
      key: units[i].key,
    });
  }

  let timeStr = "";
  if (timeUnits.length === 1) {
    const val = parseInt(timeUnits[0].val, 10);
    if (timeUnits[0].key === "hour") {
      timeStr = formatHourLabel(val, lang);
    } else if (lang === "en") {
      timeStr = timeUnits[0].val;
    } else {
      timeStr = timeUnits[0].val + units[timeStart]?.name || "";
    }
  } else if (timeUnits.length > 1) {
    // Filter out trailing zero-only segments
    const trimmed: string[] = [];
    let foundNonZero = false;
    for (let i = timeUnits.length - 1; i >= 0; i--) {
      if (parseInt(timeUnits[i].val, 10) !== 0) foundNonZero = true;
      if (foundNonZero) trimmed.unshift(timeUnits[i].val);
    }
    if (trimmed.length > 0) timeStr = trimmed.join(":");
  }

  const dateStr = lang === "en" ? dateParts.join(" ") : dateParts.join("");

  if (dateStr && timeStr) {
    return lang === "en" ? `${dateStr}, ${timeStr}` : dateStr + timeStr;
  }
  return dateStr || timeStr || "";
}

/**
 * Full time display string (used in popovers).
 * Shows all units up to precision.
 */
export function formatFullTime(
  tp: string,
  units: TU[],
  precision: number | null | undefined,
  lang: Language,
): string {
  const s = segs(tp);
  const maxIdx = precision != null ? precision : units.length - 1;

  // Collect formatted parts
  const parts: Array<{ text: string; key: string; val: number }> = [];
  for (let i = 0; i < units.length; i++) {
    if (i > maxIdx) break;
    const v = s[i + 1] || 0;
    if (v === 0 && units[i].key !== "era" && units[i].key !== "year") continue;
    parts.push({ text: "", key: units[i].key, val: v });
  }

  if (lang === "en") {
    // Format each part with proper English
    const formatted: string[] = [];
    for (const p of parts) {
      switch (p.key) {
        case "era":
          formatted.push(formatEraLabel(p.val, lang));
          break;
        case "year":
          if (p.val > 0) formatted.push(formatYearLabel(p.val, lang));
          break;
        case "month":
          if (p.val > 0) formatted.push(formatMonthLabel(p.val, lang));
          break;
        case "day":
          if (p.val > 0) formatted.push(formatDayLabel(p.val, lang));
          break;
        case "hour":
        case "minute":
        case "second":
          // Handled as a group below
          break;
        default:
          if (p.val > 0) formatted.push(`${p.val} ${p.key}`);
      }
    }

    // Time portion: collect hour/minute/second
    const hi = units.findIndex((x) => x.key === "hour");
    const timeVals: string[] = [];
    for (let i = Math.max(hi, 0); i < units.length && i <= maxIdx; i++) {
      const v = s[i + 1] || 0;
      timeVals.push(String(v).padStart(units[i].digits, "0"));
    }
    // Trim trailing zeros
    while (timeVals.length > 1 && parseInt(timeVals[timeVals.length - 1], 10) === 0) {
      timeVals.pop();
    }
    if (timeVals.length > 0) {
      formatted.push(timeVals.join(":"));
    }

    return formatted.join(", ");
  }

  // Chinese: concatenate with unit names, special case for 时分秒
  const rawParts: string[] = [];
  for (const p of parts) {
    const u = units.find((x) => x.key === p.key);
    const name = u?.name || p.key;
    rawParts.push(`${p.val}${name}`);
  }

  // Check if last 3 are 时分秒 → join with colons
  if (rawParts.length >= 3) {
    const last3 = rawParts.slice(-3);
    const labs = last3.map((p) => p.replace(/[0-9]/g, ""));
    if (labs.every((l) => l === "时" || l === "分" || l === "秒")) {
      const nums = last3.map((p) => p.replace(/[^0-9]/g, ""));
      const dates = rawParts.slice(0, -3);
      if (!nums.every((n) => n === "00" || n === "0")) {
        return dates.join("") + nums.join(":");
      }
      return dates.join("");
    }
  }
  return rawParts.join("");
}
