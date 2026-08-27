import { aggregateRows } from "./noiseAggregate.js";

const BINS = 144;
const REQUIRED = ["timestamp_utc_iso", "leq_dbfs", "peak_dbfs"];

self.onmessage = async (event) => {
  const file = event.data.file;
  try {
    const text = await file.text();
    const lines = text.split(/\r?\n/);

    let headerLine = 0;
    while (headerLine < lines.length && !lines[headerLine].trim()) headerLine++;
    const header = lines[headerLine].split(",").map((k) => k.trim().replace(/^﻿/, ""));
    const col = (name) => header.indexOf(name);
    const iTs = col("timestamp_utc_iso");
    const iInterval = col("interval_seconds");
    const iLeq = col("leq_dbfs");
    const iPeak = col("peak_dbfs");
    const iTemp = col("temperature_c");

    for (const name of REQUIRED) {
      if (col(name) === -1) throw new Error(`CSV must include ${REQUIRED.join(", ")}.`);
    }

    function* rows() {
      for (let i = headerLine + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const parts = line.split(",");
        const t = Date.parse(parts[iTs]);
        const leq = Number(parts[iLeq]);
        const peak = Number(parts[iPeak]);
        if (!Number.isFinite(t) || !Number.isFinite(leq) || !Number.isFinite(peak)) continue;
        yield {
          t,
          leq,
          peak,
          interval: iInterval >= 0 ? Number(parts[iInterval]) || 0 : 0,
          hasTemp: iTemp >= 0 && parts[iTemp] !== undefined && parts[iTemp] !== "",
        };
      }
    }

    const result = aggregateRows(rows(), BINS);
    if (!result.totalRows) throw new Error("No valid noise readings were found.");
    self.postMessage({ ok: true, result: { ...result, fileName: file.name, bins: BINS } });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : "This CSV could not be read." });
  }
};
