"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";
import { aggregateRows } from "./noiseAggregate.js";

type DayAgg = {
  key: string;
  count: number;
  duration: number;
  interval: number;
  weatherCount: number;
  leqMedian: number;
  leqP10: number;
  leqP90: number;
  leqEnergy: number;
  peakMax: number;
  events: number;
  binsLeq?: (number | null)[];
  binsPeak?: (number | null)[];
};
type NoiseSummary = {
  fileName: string;
  totalRows: number;
  bins: number;
  days: DayAgg[];
  all: DayAgg;
  medianBins: { leq: (number | null)[]; peak: (number | null)[] };
  ranges: { leq: number[]; peak: number[] };
};
type View = "intro" | "loading" | "dashboard";
type Metric = "leq" | "peak";

const FALLBACK = [-68.7, -67.1, -61.7, -55.8, -55.1, -52.8, -56.3, -57.4, -54.2, -60.1, -63.7, -58.8, -53.1, -50.4, -56.9, -58.1, -49.7, -45.4, -55.8, -61.2];
const MIN_LOADING_MS = 500;

function buildDemoSummary(): NoiseSummary {
  const rows = FALLBACK.map((leq, i) => ({ t: Date.UTC(2026, 7, 17, 21, 50, i * 5), leq, peak: leq + 22, interval: 5, hasTemp: true }));
  const result = aggregateRows(rows, 144);
  return { ...result, fileName: "sample-noise.csv", bins: 144 };
}

function DailyChart({ summary, metric, selected }: { summary: NoiseSummary; metric: Metric; selected: string }) {
  const width = 1160, height = 390, pad = { l: 58, r: 18, t: 18, b: 42 }, bins = summary.bins;
  const [yMin, yMax] = useMemo(() => {
    const [lo, hi] = summary.ranges[metric];
    return [Math.floor((lo - 4) / 10) * 10, Math.ceil((hi + 4) / 10) * 10];
  }, [summary, metric]);
  const median = metric === "leq" ? summary.medianBins.leq : summary.medianBins.peak;
  const x = (i: number) => pad.l + (i / (bins - 1)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + ((yMax - v) / (yMax - yMin)) * (height - pad.t - pad.b);
  const path = (values: (number | null)[]) => {
    let open = false;
    return values.map((v, i) => { if (v === null) { open = false; return ""; } const command = open ? "L" : "M"; open = true; return `${command}${x(i).toFixed(1)},${y(v).toFixed(1)}`; }).join(" ");
  };
  const ticks = Array.from({ length: 5 }, (_, i) => yMin + (yMax - yMin) * i / 4);
  return <svg className="daily-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric === "leq" ? "Leq" : "Peak"} sound levels across a 24-hour day`}>
    {ticks.map(v => <g key={v}><line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className="chart-grid" /><text x={pad.l - 12} y={y(v) + 4} textAnchor="end">{v.toFixed(0)}</text></g>)}
    {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(h => <g key={h}><line x1={pad.l + h / 24 * (width - pad.l - pad.r)} x2={pad.l + h / 24 * (width - pad.l - pad.r)} y1={pad.t} y2={height - pad.b} className="chart-grid vertical-grid" /><text x={pad.l + h / 24 * (width - pad.l - pad.r)} y={height - 13} textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"}>{String(h).padStart(2, "0")}:00</text></g>)}
    {summary.days.map(d => <path key={d.key} d={path(metric === "leq" ? d.binsLeq! : d.binsPeak!)} className={d.key === selected ? "day-line selected-day" : "day-line"} />)}
    <path d={path(median)} className="median-line" /><text x="14" y="22" className="axis-title">dBFS</text>
  </svg>;
}

function Loading() { return <main className="loading-screen"><div className="liquid-shell"><div className="liquid-core" /><div className="liquid-glint" /><span>Reading your soundscape</span></div><p>Organising measurements from midnight to midnight</p></main>; }

export default function Home() {
  const [view, setView] = useState<View>("intro"), [summary, setSummary] = useState<NoiseSummary | null>(null), [fileError, setFileError] = useState(""), [metric, setMetric] = useState<Metric>("leq"), [selected, setSelected] = useState("");
  const workerRef = useRef<Worker | null>(null);

  const enter = (result: NoiseSummary) => { setSummary(result); setSelected(result.days[0]?.key ?? "all"); setView("dashboard"); window.scrollTo(0, 0); };

  const loadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError("");
    setView("loading");
    window.scrollTo(0, 0);
    const started = performance.now();
    try {
      if (!workerRef.current) workerRef.current = new Worker(new URL("./parseWorker.js", import.meta.url));
      const worker = workerRef.current;
      const result = await new Promise<NoiseSummary>((resolve, reject) => {
        worker.onmessage = (ev: MessageEvent) => ev.data.ok ? resolve(ev.data.result) : reject(new Error(ev.data.error));
        worker.onerror = (ev) => reject(new Error(ev.message || "This CSV could not be read."));
        worker.postMessage({ file });
      });
      const elapsed = performance.now() - started;
      if (elapsed < MIN_LOADING_MS) await new Promise(r => setTimeout(r, MIN_LOADING_MS - elapsed));
      enter(result);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "This CSV could not be read.");
      setView("intro");
    } finally {
      e.target.value = "";
    }
  };
  const loadDemo = () => enter(buildDemoSummary());

  if (view === "loading") return <Loading />;
  if (view === "intro") return <main className="portal"><nav className="portal-nav"><a className="frontera" href="#opening"><span className="frontera-mark"><i /><i /><i /></span><span>Frontera<br />Data Labs</span></a><span>HOME NOISE / 001</span><span className="portal-status"><i /> LOCAL DATA</span></nav><section id="opening" className="portal-hero"><div className="signal-sky" aria-hidden="true"><i /><i /><i /><i /><i /></div><p className="portal-kicker">THE CITY IS ALWAYS SPEAKING</p><h1>Explore the vital signs<br /><em>around your home.</em></h1><p className="portal-copy">Turn sound measurements into a living view of the rhythms, interruptions and quiet moments shaping your environment.</p><a className="portal-scroll" href="#begin"><span>SCROLL TO BEGIN</span><i /></a><div className="portal-foot"><span>TIME-AVERAGED SOUND · LEQ</span><span>INSTANTANEOUS PEAK · dBFS</span><span>PRIVATE BY DESIGN</span></div></section><section id="begin" className="begin-section"><div className="begin-grid" aria-hidden="true" /><div className="begin-orbit orbit-one" /><div className="begin-orbit orbit-two" /><p className="portal-kicker">YOUR DATA · YOUR ENVIRONMENT</p><h2>Ready to begin?</h2><p>Select a StreetNoise Monitor CSV. It is processed locally in this browser and is never uploaded.</p><label className="file-button"><input type="file" accept=".csv,text/csv" onChange={loadFile} /><span>Choose noise CSV</span><b>↗</b></label><button className="demo-button" onClick={loadDemo}>or explore the sample capture</button>{fileError && <div className="file-error" role="alert">{fileError}</div>}<div className="required-fields"><span>REQUIRED FIELDS</span><b>timestamp_utc_iso</b><b>leq_dbfs</b><b>peak_dbfs</b></div></section></main>;

  const s = summary!;
  const selectedDay = s.days.find(d => d.key === selected);
  const stats = selected === "all" ? s.all : selectedDay ?? s.all;
  const range = stats.leqP90 - stats.leqP10;

  return <main className="dashboard-shell">
    <aside className="sidebar"><a className="frontera dashboard-logo" href="#"><span className="frontera-mark"><i /><i /><i /></span><span>Frontera<br />Data Labs</span></a><nav><a className="active" href="#overview"><span>⌁</span>Overview</a><a href="#daily"><span>⌇</span>Daily dynamics</a><a href="#insights"><span>◇</span>Insights</a><a href="#data"><span>⊞</span>Data quality</a></nav><div className="side-bottom"><small>SENSOR</small><b><i /> Home 01</b><span>Local CSV</span></div></aside>
    <section className="dashboard-main" id="overview"><header className="dash-header"><div><p>HOME ENVIRONMENT</p><h1>Noise dynamics</h1></div><div className="header-actions"><div className="file-pill"><span>{s.fileName}</span><small>{s.totalRows.toLocaleString()} readings</small></div><button onClick={() => { setView("intro"); setSummary(null); window.scrollTo(0, 0); }}>Change CSV</button></div></header>
      <div className="summary-grid"><article><span>Energy average</span><strong>{stats.leqEnergy.toFixed(1)}<small>dBFS</small></strong><p>Logarithmic mean for selection</p></article><article><span>Median Leq</span><strong>{stats.leqMedian.toFixed(1)}<small>dBFS</small></strong><p>Typical relative sound level</p></article><article><span>Maximum peak</span><strong>{stats.peakMax.toFixed(1)}<small>dBFS</small></strong><p>Highest instantaneous digital peak</p></article><article><span>Observed time</span><strong>{(stats.duration / 60).toFixed(1)}<small>min</small></strong><p>{stats.count} measurements</p></article></div>
      <section className="dashboard-card chart-card" id="daily"><div className="card-head"><div><p>24-HOUR PROFILE</p><h2>Daily sound distribution</h2><span>Soft grey: every recorded day · Black: median across days · Green: selected day</span></div><div className="metric-toggle"><button className={metric === "leq" ? "on" : ""} onClick={() => setMetric("leq")}>Leq</button><button className={metric === "peak" ? "on" : ""} onClick={() => setMetric("peak")}>Peak</button></div></div><div className="date-selector"><button className={selected === "all" ? "selected" : ""} onClick={() => setSelected("all")}><b>ALL</b><span>Median view</span></button>{s.days.map(d => { const dt = new Date(`${d.key}T12:00:00`); return <button key={d.key} className={selected === d.key ? "selected" : ""} onClick={() => setSelected(d.key)}><b>{dt.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase()}</b><span>{dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span></button>; })}</div><DailyChart summary={s} metric={metric} selected={selected} /><div className="chart-note"><i /> Empty parts of the timeline are unobserved. The dashboard never fills or interpolates gaps.</div></section>
      <div className="lower-grid"><section className="dashboard-card" id="insights"><div className="card-head"><div><p>RELATIVE INSIGHTS</p><h2>What changed?</h2></div><span className="status-tag">dBFS · NOT CALIBRATED SPL</span></div><div className="insight-list"><article><i>01</i><div><b>{range.toFixed(1)} dB acoustic spread</b><p>The L10–L90 difference describes how variable the selected soundscape was.</p></div></article><article><i>02</i><div><b>{stats.events} elevated readings</b><p>Measurements at least 6 dB above this selection’s median; consecutive readings are not yet merged into events.</p></div></article><article><i>03</i><div><b>Health thresholds remain locked</b><p>dBFS cannot be compared with WHO dB(A) guidance until the phone is calibrated and A-weighting is implemented.</p></div></article></div></section><section className="dashboard-card" id="data"><div className="card-head"><div><p>CAPTURE QUALITY</p><h2>Data coverage</h2></div></div><div className="coverage-visual"><div className="coverage-clock"><span style={{ "--coverage": Math.min(100, stats.duration / 1440 / 60 * 100) } as React.CSSProperties} /><b>{(stats.duration / 1440 / 60 * 100).toFixed(2)}%</b><small>of selected day</small></div><div><p><span>Readings</span><b>{stats.count}</b></p><p><span>Interval</span><b>{stats.interval || "—"} sec</b></p><p><span>Weather</span><b>{stats.weatherCount} rows</b></p></div></div></section></div>
    </section>
  </main>;
}
