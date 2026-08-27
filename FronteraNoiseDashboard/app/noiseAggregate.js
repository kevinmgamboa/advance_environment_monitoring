// Shared, Intl-cache-friendly aggregation used by both the CSV parse worker
// and the demo dataset on the main thread. Keeping this logic in one place
// (and free of per-row Intl allocations) is what makes loading fast: a
// week of 5s-interval readings collapses into a handful of small day
// summaries instead of tens of thousands of React-visible rows.

const TIME_ZONE = "Europe/London";

let dayFormatter = null;
let clockFormatter = null;

function keyers() {
  if (!dayFormatter) {
    dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
    clockFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return { dayFormatter, clockFormatter };
}

// Attaches a local day key ("2026-08-17") and a 10-minute bin index (0-143)
// to a raw {t, leq, peak, interval, hasTemp} row, using cached formatters
// instead of constructing a new Intl.DateTimeFormat per row (the single
// biggest cost in the previous implementation).
export function locate(t, bins) {
  const { dayFormatter, clockFormatter } = keyers();
  const date = new Date(t);
  const dayKey = dayFormatter.format(date);
  const parts = clockFormatter.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const bin = Math.min(bins - 1, Math.floor((hour * 60 + minute) / (1440 / bins)));
  return { dayKey, bin };
}

export function quantile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.round((sorted.length - 1) * p)];
}

function emptyGroup() {
  return { leq: [], peak: [], duration: 0, count: 0, weatherCount: 0, interval: 0 };
}

function summarize(key, group, bins) {
  const leqSorted = [...group.leq].sort((a, b) => a - b);
  const peakSorted = [...group.peak].sort((a, b) => a - b);
  const median = quantile(leqSorted, 0.5) ?? 0;
  const energy = group.leq.length ? 10 * Math.log10(group.leq.reduce((s, v) => s + 10 ** (v / 10), 0) / group.leq.length) : 0;
  const events = median !== null ? group.leq.filter((v) => v >= median + 6).length : 0;
  const binsLeq = bins ? group.binLeq.map((vals) => (vals.length ? quantile([...vals].sort((a, b) => a - b), 0.5) : null)) : undefined;
  const binsPeak = bins ? group.binPeak.map((vals) => (vals.length ? quantile([...vals].sort((a, b) => a - b), 0.5) : null)) : undefined;
  return {
    key,
    count: group.count,
    duration: group.duration,
    interval: group.interval,
    weatherCount: group.weatherCount,
    leqMedian: median,
    leqP10: quantile(leqSorted, 0.1) ?? median,
    leqP90: quantile(leqSorted, 0.9) ?? median,
    leqEnergy: energy,
    peakMax: peakSorted.length ? peakSorted[peakSorted.length - 1] : 0,
    events,
    binsLeq,
    binsPeak,
  };
}

// rows: iterable of {t:number(epoch ms), leq:number, peak:number, interval:number, hasTemp:boolean}
export function aggregateRows(rows, bins) {
  const dayGroups = new Map();
  const all = emptyGroup();
  let leqMin = Infinity, leqMax = -Infinity, peakMin = Infinity, peakMax = -Infinity;
  let totalRows = 0;

  for (const row of rows) {
    const { t, leq, peak, interval, hasTemp } = row;
    if (!Number.isFinite(t) || !Number.isFinite(leq) || !Number.isFinite(peak)) continue;
    const { dayKey, bin } = locate(t, bins);

    let group = dayGroups.get(dayKey);
    if (!group) {
      group = emptyGroup();
      group.binLeq = Array.from({ length: bins }, () => []);
      group.binPeak = Array.from({ length: bins }, () => []);
      group.interval = interval;
      dayGroups.set(dayKey, group);
    }
    group.leq.push(leq);
    group.peak.push(peak);
    group.binLeq[bin].push(leq);
    group.binPeak[bin].push(peak);
    group.duration += interval;
    group.count++;
    if (hasTemp) group.weatherCount++;

    all.leq.push(leq);
    all.peak.push(peak);
    all.duration += interval;
    all.count++;
    if (hasTemp) all.weatherCount++;
    if (totalRows === 0) all.interval = interval;

    if (leq < leqMin) leqMin = leq;
    if (leq > leqMax) leqMax = leq;
    if (peak < peakMin) peakMin = peak;
    if (peak > peakMax) peakMax = peak;
    totalRows++;
  }

  const days = [...dayGroups.entries()]
    .map(([key, group]) => summarize(key, group, bins))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const medianBins = {
    leq: Array.from({ length: bins }, (_, i) => {
      const vals = days.map((d) => d.binsLeq[i]).filter((v) => v !== null);
      return vals.length ? quantile([...vals].sort((a, b) => a - b), 0.5) : null;
    }),
    peak: Array.from({ length: bins }, (_, i) => {
      const vals = days.map((d) => d.binsPeak[i]).filter((v) => v !== null);
      return vals.length ? quantile([...vals].sort((a, b) => a - b), 0.5) : null;
    }),
  };

  return {
    totalRows,
    days,
    all: summarize("all", all, 0),
    medianBins,
    ranges: {
      leq: totalRows ? [leqMin, leqMax] : [0, 0],
      peak: totalRows ? [peakMin, peakMax] : [0, 0],
    },
  };
}
