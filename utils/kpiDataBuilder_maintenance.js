/**
 * kpiDataBuilder_maintenance.js- CONFIDENTIAL - PROPERTY OF PARETOPS
 * 
 * For support or integration questions, contact: support@paretops.com
 * 
 * This module is responsible for generating, processing, and serving all maintenance-related KPIs 
 * in the ParetOPS platform. It aggregates data from the `maintenance_logs` SQL table and computes 
 * meaningful metrics to support reliability, availability, and maintainability analysis.
 * 
 * MAIN FUNCTIONALITIES:
 * - Compute time-series KPIs for maintenance performance across all machines and weeks:
 *   • Mean Downtime (h)
 *   • Frequency of Machine Interventions (per week)
 *   • MTBF (Mean Time Between Failures)
 *   • Maintenance Operation Efficiency (%)
 * - Identify top downtime contributors for root cause analysis
 * - Support maintenance benchmarking logic using weighted scoring formulas
 * - Provide maintenance summary data with delta trends and alerts (recurring issues, long downtimes)
 * 
 * SUPPORTING FEATURES:
 * - Dynamically split downtime across ISO weeks (FWxx-YYYY format) and machines
 * - Allow filtering of results over 1, 6, or 12-month ranges
 * - Exclude non-failure events from MTBF calculations (e.g., PM, training, meetings)
 * - Return per-machine KPI breakdowns for charting and advanced dashboards
 * 
 * API ROUTES (via `maintenanceRouter`):
 * - `/api/maintenance/kpi`                 → Returns all computed KPIs and contributors
 * - `/api/save-threshold`                  → Save per-KPI thresholds and improvement goals
 * - `/api/get-threshold`                   → Retrieve saved threshold and goal for a KPI
 * - `/api/maintenance/benchmark`           → Maintenance benchmarking with weighted scoring
 * - `/api/logs/:plyCutter`                 → Return last 10 logs for a specific machine
 * - `/api/maintenance/summary`            → Returns downtime trends and active downtime alerts
 * 
 * DATA SOURCES:
 * - `maintenance_logs`: Start/end time, reason, duration per intervention
 * - `kpi_preferences_maintenance`: Stores thresholds and performance goals
 * 
 * DESIGN NOTES:
 * - Time logic is normalized using server local time (UTC internally)
 * - All outputs are structured for direct frontend consumption (labels, values, machines)
 * - Scoring logic in benchmark is calibrated with capping to ensure fairness
 * - This module supports both real-time display and PDF report generation
 * 
 * AUTHOR: Paulin Colin BANCKAERT
 * VERSION: v3.0.0
 * LAST UPDATED: May 2025
 *   - Managed under Git. Tag any changes that impact frontend structure or KPI logic.
 */


// Load environment variables and dependencies
require('dotenv').config();
const express = require('express');
const maintenanceRouter = express.Router();
const { getPlannedAndUnplannedDowntime } = require('./kpiDataBuilder');
const machineFiltersByKpi = {};


const mysql = require('mysql2');

// Create a MySQL connection pool for performing database operations
const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  timezone: 'Z',
  waitForConnections: true,
  connectionLimit: 10
});

// Utility function: Returns the ISO week number (1 to 53) for a given date
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// Utility function: Returns the next Monday following a given date
function getNextMonday(date) {
  const result = new Date(date);
  const day = result.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

// Main function: Computes all maintenance KPIs and top contributors over the selected date range
async function getMaintenanceKpiData(range = '1m') {
  // Interval
  let interval = '1 MONTH';
  if (range === '6m') interval = '6 MONTH';
  else if (range === '12m') interval = '12 MONTH';

  // Downtime contributors (inchangé)
  const contributorsSql = `
    SELECT reason, ROUND(SUM(duration), 2) AS total_hours
    FROM maintenance_logs
    WHERE end_time IS NOT NULL AND duration > 0
      AND start_time >= DATE_SUB(NOW(), INTERVAL ${interval})
    GROUP BY reason
    ORDER BY total_hours DESC
  `;
  const contributors = await new Promise((resolve, reject) => {
    db.query(contributorsSql, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });

  // Logs pour mean downtime global + par machine
  const logsSql = `
    SELECT start_time, end_time, duration, plyCutter
    FROM maintenance_logs
    WHERE end_time IS NOT NULL AND duration > 0
      AND start_time >= DATE_SUB(NOW(), INTERVAL ${interval})
  `;
  const logs = await new Promise((resolve, reject) => {
    db.query(logsSql, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });

  const weeklyTotal = {};     // ex: 'FW15-2024': { total: x, count: y }
  const weeklyByMachine = {}; // ex: PC1: { 'FW15-2024': { total, count } }

  for (const log of logs) {
    const start = new Date(log.start_time);
    const end = new Date(log.end_time);
    const machine = log.plyCutter;
    let current = new Date(start);

    while (current < end) {
      const year = current.getFullYear();
      const week = getWeekNumber(current);
      const label = `FW${week}-${year}`;

      const nextMonday = getNextMonday(current);
      const segmentEnd = nextMonday < end ? nextMonday : end;
      const hours = (segmentEnd - current) / (1000 * 60 * 60);

      // Global aggregation
      if (!weeklyTotal[label]) weeklyTotal[label] = { total: 0, count: 0 };
      weeklyTotal[label].total += hours;
      weeklyTotal[label].count += 1;

      // Per-machine aggregation
      if (!weeklyByMachine[machine]) weeklyByMachine[machine] = {};
      if (!weeklyByMachine[machine][label]) {
        weeklyByMachine[machine][label] = { total: 0, count: 0 };
      }
      weeklyByMachine[machine][label].total += hours;
      weeklyByMachine[machine][label].count += 1;

      current = segmentEnd;
    }
  }

  const allWeeks = Object.keys(weeklyTotal).sort();

  const meanDowntimeKpi = {
    labels: allWeeks,
    values: allWeeks.map(l => +(weeklyTotal[l].total / weeklyTotal[l].count).toFixed(2)),
    machines: {}
  };

  for (const [machine, weekData] of Object.entries(weeklyByMachine)) {
    meanDowntimeKpi.machines[machine] = allWeeks.map(label => {
      const entry = weekData[label];
      return entry ? +(entry.total / entry.count).toFixed(2) : null;
    });
  }

  // ---- Frequency of Machine Interventions (interventions/week) ----
  const frequencySql = `
  SELECT 
    plyCutter,
    YEAR(start_time) AS year,
    WEEK(start_time, 1) AS week,
    COUNT(*) AS count
  FROM maintenance_logs
  WHERE start_time >= DATE_SUB(NOW(), INTERVAL ${interval})
  GROUP BY plyCutter, year, week
  ORDER BY year, week
  `;
  const mtbfWeeks = new Set();
  const frequencyRows = await new Promise((resolve, reject) => {
  db.query(frequencySql, (err, results) => {
    if (err) return reject(err);
    resolve(results);
  });
  });

  const weekSet = new Set();
  const byMachine = {};
  const totalPerWeek = {};

  for (const row of frequencyRows) {
  const label = `FW${row.week}-${row.year}`;
  weekSet.add(label);

  if (!byMachine[row.plyCutter]) byMachine[row.plyCutter] = {};
  byMachine[row.plyCutter][label] = row.count;

  totalPerWeek[label] = (totalPerWeek[label] || 0) + row.count;
  }

  const allWeeksSorted = Array.from(weekSet).sort((a, b) => {
  const [fwA, yA] = a.split('-').map(s => parseInt(s.replace('FW', '')));
  const [fwB, yB] = b.split('-').map(s => parseInt(s.replace('FW', '')));
  return yA !== yB ? yA - yB : fwA - fwB;
  });

  const frequencyKpi = {
  labels: allWeeksSorted,
  values: allWeeksSorted.map(w => totalPerWeek[w] || 0),
  machines: {}
  };

  for (const [pc, map] of Object.entries(byMachine)) {
  frequencyKpi.machines[pc] = allWeeksSorted.map(w => map[w] || 0);
  }

  // ---- MTBF (Mean Time Between Failures) ----
  // Assume: only maintenance_logs count as failures
  const mtbfSql = `
    SELECT start_time, plyCutter
    FROM maintenance_logs
    WHERE end_time IS NOT NULL
      AND duration > 0
      AND reason NOT IN ('Not Specified', 'PM', 'Training', 'Meeting')
      AND start_time >= DATE_SUB(NOW(), INTERVAL ${interval})
    ORDER BY plyCutter, start_time
  `;

  const mtbfRows = await new Promise((resolve, reject) => {
  db.query(mtbfSql, (err, results) => {
    if (err) return reject(err);
    resolve(results);
  });
  });

  const machineIntervals = {};  // PC1: [duration1, duration2, ...]

  for (const row of mtbfRows) {
  const pc = row.plyCutter;
  const current = new Date(row.start_time);

  if (!machineIntervals[pc]) {
    machineIntervals[pc] = { prev: null, list: [], weekMap: {} };
  }

  const prev = machineIntervals[pc].prev;
  if (prev) {
    const deltaH = (current - prev) / (1000 * 60 * 60);
    const week = getWeekNumber(current);
    const year = current.getFullYear();
    const label = `FW${week}-${year}`;
    mtbfWeeks.add(label);

    // Save into global list
    machineIntervals[pc].list.push({ week: label, delta: deltaH });

    // Accumulate by week
    if (!machineIntervals[pc].weekMap[label]) {
      machineIntervals[pc].weekMap[label] = { total: 0, count: 0 };
    }
    machineIntervals[pc].weekMap[label].total += deltaH;
    machineIntervals[pc].weekMap[label].count += 1;
  }

  machineIntervals[pc].prev = current;
  }

  // Build global MTBF
  const weeksSorted = Array.from(mtbfWeeks).sort((a, b) => {
  const [fwA, yA] = a.split('-').map(s => parseInt(s.replace('FW', '')));
  const [fwB, yB] = b.split('-').map(s => parseInt(s.replace('FW', '')));
  return yA !== yB ? yA - yB : fwA - fwB;
  });

  const globalTotals = {};
  for (const pc of Object.keys(machineIntervals)) {
  for (const entry of machineIntervals[pc].list) {
    const w = entry.week;
    if (!globalTotals[w]) globalTotals[w] = { total: 0, count: 0 };
    globalTotals[w].total += entry.delta;
    globalTotals[w].count += 1;
  }
  }

  const mtbfKpi = {
  labels: weeksSorted,
  values: weeksSorted.map(w => {
    const data = globalTotals[w];
    return data ? +(data.total / data.count).toFixed(2) : null;
  }),
  machines: {}
  };

  for (const pc of Object.keys(machineIntervals)) {
  mtbfKpi.machines[pc] = weeksSorted.map(w => {
    const d = machineIntervals[pc].weekMap[w];
    return d ? +(d.total / d.count).toFixed(2) : null;
  });
  }

  // ---- Maintenance Operation Efficiency (%) ----
  const efficiencyKpi = {
    labels: mtbfKpi.labels,
    values: [],
    machines: {}
  };

  efficiencyKpi.values = mtbfKpi.labels.map((label, i) => {
    const mtbf = mtbfKpi.values[i];
    const mdt = meanDowntimeKpi.values[i];
    if (mtbf != null && mdt != null && (mtbf + mdt) !== 0) {
      return +((mtbf / (mtbf + mdt)) * 100).toFixed(1);
    }
    return null;
  });

  for (const pc of Object.keys(mtbfKpi.machines)) {
    efficiencyKpi.machines[pc] = mtbfKpi.machines[pc].map((mtbfVal, i) => {
      const mdtVal = meanDowntimeKpi.machines?.[pc]?.[i];
      if (mtbfVal != null && mdtVal != null && (mtbfVal + mdtVal) !== 0) {
        return +((mtbfVal / (mtbfVal + mdtVal)) * 100).toFixed(1);
      }
      return null;
    });
  }




  return {
    contributors,
    kpis: {
      "Mean Downtime (h)": meanDowntimeKpi,
      "Frequency of Machine Interventions (interventions/week)": frequencyKpi,
      "MTBF (h)": mtbfKpi,
      "Maintenance Operation Efficiency (%)": efficiencyKpi
    }
  };
}

// Save user-defined threshold and optimization goal (maximize/minimize) for a maintenance KPI
maintenanceRouter.post('/api/save-threshold', (req, res) => {
  const { kpi, threshold, goal } = req.body;

  const fetchSql = `SELECT thresholds, goals FROM kpi_preferences_maintenance WHERE id = 1`;
  db.query(fetchSql, (err, rows) => {
    if (err) {
      console.error('Failed to fetch preferences:', err);
      return res.status(500).json({ error: 'Database fetch error' });
    }

    let thresholds = {};
    let goals = {};

    try {
      // Safely parse only if stored as string
      thresholds = typeof rows[0].thresholds === 'string'
        ? JSON.parse(rows[0].thresholds)
        : rows[0].thresholds || {};
      goals = typeof rows[0].goals === 'string'
        ? JSON.parse(rows[0].goals)
        : rows[0].goals || {};
    } catch (parseErr) {
      console.warn('Failed to parse stored JSON. Resetting to empty.');
      thresholds = {};
      goals = {};
    }

    // Update values
    thresholds[kpi] = threshold;
    goals[kpi] = goal;

    // Save updated preferences back to the database
    const updateSql = `
      UPDATE kpi_preferences_maintenance 
      SET thresholds = ?, goals = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = 1
    `;
    db.query(updateSql, [JSON.stringify(thresholds), JSON.stringify(goals)], (err) => {
      if (err) {
        console.error('Failed to update preferences:', err);
        return res.status(500).json({ error: 'Database update error' });
      }
      res.sendStatus(200);
    });
  });
});

// Retrieve saved threshold and goal for a specific maintenance KPI
maintenanceRouter.get('/api/get-threshold', (req, res) => {
  const kpi = req.query.kpi;
  if (!kpi) return res.status(400).json({ error: 'Missing kpi parameter' });

  const sql = `SELECT thresholds, goals FROM kpi_preferences_maintenance WHERE id = 1`;
  db.query(sql, (err, rows) => {
    if (err) {
      console.error('Failed to fetch preferences:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    let thresholds = {};
    let goals = {};

    try {
      thresholds = typeof rows[0].thresholds === 'string'
        ? JSON.parse(rows[0].thresholds)
        : rows[0].thresholds || {};
      goals = typeof rows[0].goals === 'string'
        ? JSON.parse(rows[0].goals)
        : rows[0].goals || {};
    } catch (parseErr) {
      console.warn('Failed to parse stored JSON. Resetting to empty.');
      thresholds = {};
      goals = {};
    }

    res.json({
      threshold: thresholds[kpi] ?? null,
      goal: goals[kpi] ?? 'maximize'
    });
  });
});

// Generate a benchmark score (10–99) for each machine based on DT, MTBF, MDT
maintenanceRouter.get('/api/maintenance/benchmark', async (req, res) => {
  try {
    // Step 1: Get raw totals from SQL over the past 6 months
    const sql = `
      SELECT 
        plyCutter,
        ROUND(AVG(duration), 2) AS avg_duration,
        COUNT(*) AS interventions,
        ROUND(SUM(duration), 2) AS total_duration
      FROM maintenance_logs
      WHERE end_time IS NOT NULL AND duration > 0
        AND start_time >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY plyCutter
    `;

    const rows = await new Promise((resolve, reject) => {
      db.query(sql, (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    // Step 2: Use existing KPI engine to fetch MTBF + MDT (real values)
    const kpiData = await getMaintenanceKpiData('6m');
    const mtbfMap = kpiData.kpis['MTBF (h)']?.machines || {};
    const mdtMap = kpiData.kpis['Mean Downtime (h)']?.machines || {};

    // Step 3: Get total downtime per machine in hours
    const dtQuery = `
      SELECT plyCutter, SUM(duration) AS total_dt
      FROM maintenance_logs
      WHERE end_time IS NOT NULL AND duration > 0
        AND reason NOT IN ('PM', 'Training', 'Meeting')
        AND start_time >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY plyCutter;
    `;
  

    const dtMap = await new Promise((resolve, reject) => {
      db.query(dtQuery, (err, results) => {
        if (err) return reject(err);
        resolve(results.reduce((acc, row) => {
          acc[row.plyCutter] = +(parseFloat(row.total_dt) || 0).toFixed(1);
          return acc;
        }, {}));
      });
    });

    // Step 4: Merge all data per machine
    // Sort ply cutters by numeric order (PC1 → PC9)
    rows.sort((a, b) => {
      const numA = parseInt(a.plyCutter.replace('PC', ''));
      const numB = parseInt(b.plyCutter.replace('PC', ''));
      return numA - numB;
    });
    const machines = rows.map(row => {
      const pc = row.plyCutter;
      const mtbfArr = mtbfMap[pc] || [];
      const mdtArr = mdtMap[pc] || [];

      const mtbf = average(mtbfArr);
      const mdt = average(mdtArr); // keep MDT in hours
      const dt = dtMap[pc] ?? 0;

      // New scoring formula: DT is most important, then MTBF, then MDT
      const dtScore   = 1 - Math.min(dt / 500, 1);         // DT capped at 500h
      const mtbfScore = Math.min(mtbf / 1000, 1);          // MTBF capped at 1000h
      const mdtScore  = 1 - Math.min(mdt / 100, 1);        // MDT capped at 100h

      const rawScore = dtScore * 0.6 + mtbfScore * 0.3 + mdtScore * 0.1;  // weighted
      const score = Math.round(10 + rawScore * 89);  // final range = 10–99


      return {
        name: pc,
        score: Math.round(score),
        dt,
        mdt: +mdt.toFixed(1),
        mtbf: +mtbf.toFixed(1)
      };
    });

    res.json({ machines });
  } catch (err) {
    console.error("Benchmark route failed:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Fetch the 10 most recent maintenance logs for a specific ply cutter
maintenanceRouter.get('/api/logs/:plyCutter', (req, res) => {
  const pc = req.params.plyCutter;
  const sql = `
    SELECT start_time, end_time, duration, reason, work_order, comment
    FROM maintenance_logs
    WHERE plyCutter = ?
    ORDER BY start_time DESC
    LIMIT 10
  `;
  db.query(sql, [pc], (err, results) => {
    if (err) {
      console.error('Failed to fetch logs:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(results);
  });
});

// Utility function: Computes the average of an array, excluding null values
function average(arr) {
  const valid = arr.filter(x => x != null);
  return valid.length === 0 ? 0 : valid.reduce((a, b) => a + b, 0) / valid.length;
}

// Generate a summary of total downtime (current and previous 30 days) and alert conditions
maintenanceRouter.get('/api/maintenance/summary', async (req, res) => {
  try {
    // 🔁 1. Original fields (required for legacy frontend: downtime counter and delta)
    const [currentRow] = await db.promise().query(`
      SELECT SUM(duration) AS total
      FROM maintenance_logs
      WHERE duration > 0
        AND start_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        AND end_time IS NOT NULL
    `);
    const [previousRow] = await db.promise().query(`
      SELECT SUM(duration) AS total
      FROM maintenance_logs
      WHERE duration > 0
        AND start_time >= DATE_SUB(NOW(), INTERVAL 60 DAY)
        AND start_time < DATE_SUB(NOW(), INTERVAL 30 DAY)
        AND end_time IS NOT NULL
    `);

    const current_30_days = parseFloat(currentRow[0].total || 0);
    const previous_30_days = parseFloat(previousRow[0].total || 0);
    const delta = +(current_30_days - previous_30_days).toFixed(1);

    // ✅ 2. New: Recurring issue alert → find machines with >3 downtimes this month
    const [recurring] = await db.promise().query(`
      SELECT plyCutter, COUNT(*) AS count
      FROM maintenance_logs
      WHERE duration > 0
        AND start_time >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        AND end_time IS NOT NULL
      GROUP BY plyCutter
      HAVING count > 3
      ORDER BY count DESC
    `);

    // ✅ 3. New: Long downtime alert → machines still down for over 24h
    const [long] = await db.promise().query(`
      SELECT 
        plyCutter, 
        TIMESTAMPDIFF(HOUR, start_time, NOW()) AS hours
      FROM maintenance_logs
      WHERE end_time IS NULL
        AND start_time IS NOT NULL
        AND TIMESTAMPDIFF(HOUR, start_time, NOW()) >= 24
      ORDER BY hours DESC
    `);

    // ✅ Final response: legacy fields preserved + new alert fields added
    res.json({
      total_downtime_hours: +current_30_days.toFixed(1),       // used by downtime card
      difference_vs_previous: delta,                           // used by downtime card

      downtimeTrend: {                                         // used by alert logic
        current_30_days: +current_30_days.toFixed(1),
        previous_30_days: +previous_30_days.toFixed(1)
      },
      recurringIssues: recurring.map(r => ({
        plyCutter: r.plyCutter,
        count: r.count
      })),
      longDowntime: long.map(l => ({
        plyCutter: l.plyCutter,
        hours: l.hours
      }))
    });

  } catch (err) {
    console.error("❌ Failed to get downtime summary:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Export KPI calculation function and route definitions for use in other parts of the application
module.exports = {
  getMaintenanceKpiData,
  maintenanceRouter
};
