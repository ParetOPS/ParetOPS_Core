/**
 * kpiDataBuilder.js - CONFIDENTIAL - PROPERTY OF PARETOPS
 * 
 * For support or integration questions, contact: support@paretops.com
 * 
 * This module is responsible for aggregating, calculating, and serving all production and maintenance KPIs 
 * used in the ParetOPS performance dashboard. It builds a structured dataset from multiple SQL sources 
 * and prepares it for frontend rendering, benchmarking, and export.
 * 
 * KEY RESPONSIBILITIES:
 * - Aggregate production and downtime data across all ply cutters and shifts.
 * - Compute a wide range of KPIs, including:
 *   • Production Achievement (%)
 *   • Planned and Unplanned Downtime (h)
 *   • Availability (%)
 *   • Corrective Maintenance Rate (%)
 *   • Cycle Time (h) and Changeover Time (h)
 *   • Efficiency (%) per machine and shift
 *   • Yield (%) based on defects
 *   • OEE (%) as composite KPI (Eff × Avail × Yield)
 *   • Active Utilization (%)
 *   • Help Request Rate and Response Time
 * - Normalize and align time-series data across all KPIs for daily, shift, and machine-level granularity.
 * - Handle historical calculations, weekend exclusions, runtime validation, and KPI capping logic.
 * 
 * DATABASE TABLES USED:
 * - `ply_cutter_obj`: main table for production counts, shift tracking, and program assignment.
 * - `reported_issues`: used to derive unplanned and planned downtime.
 * - `maintenance_logs`: used to complement downtime calculations.
 * - `machining_times`: stores expected machining times per program.
 * - `help_requests`: supports help response time KPIs.
 * - `kpi_yield_data`: contains monthly defect counts for Yield (%) calculation.
 * 
 * API ROUTES EXPORTED:
 * - GET `/api/kpi`           → Returns a JSON object with all KPIs (production, availability, OEE, etc.)
 * - GET `/api/preferences`   → Returns stored thresholds, goals, and highlights.
 * - POST `/api/preferences`  → Stores updated thresholds, goals, and highlights.
 * - GET `/api/get-machining-times` → Retrieves current expected machining times per program.
 * - POST `/api/update-machining-times` → Updates machining times in database.
 * - POST `/api/save-summary` → Generates and saves PDF executive summary from frontend.
 * - GET `/api/reports`       → Lists available PDF reports in reverse chronological order.
 * 
 * ADDITIONAL UTILITIES:
 * - Time alignment in Austin local time (CST/CDT)
 * - Downtime split logic per day and per shift
 * - Dynamic PDF generation with Puppeteer for reporting
 * 
 * STRUCTURE:
 * The module combines heavy SQL data processing with helper functions to split time blocks,
 * validate shifts, handle data inconsistencies, and optimize chart rendering logic.
 * 
 * AUTHOR: Paulin Colin BANCKAERT
 * VERSION: v3.0.0 (core)
 * 
 * WARNING:
  - Managed under Git. Tag any changes that impact frontend structure or KPI logic.
 * Avoid inserting raw strings into queries without proper validation — this module interfaces directly with production data.
 */


// Load environment variables and database connection
require('dotenv').config();
const express = require('express');
const router = express.Router();
const mysql = require('mysql2');
const { getAustinDateStringFromISO } = require('./utils.server');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// PDF reports will be saved there
const REPORT_DIR = path.join(__dirname, 'reports');
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR);

// Force Puppeteer temp/profile paths to a writable folder under /utils/reports
const PUP_TMP = path.join(REPORT_DIR, '.puppeteer_tmp');
fs.mkdirSync(PUP_TMP, { recursive: true });

// Make Node/Puppeteer derive os.tmpdir() from here
process.env.TMP = PUP_TMP;
process.env.TEMP = PUP_TMP;
process.env.TMPDIR = PUP_TMP;
// Puppeteer also respects this:
process.env.PUPPETEER_TMP_DIR = PUP_TMP;



const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  timezone: 'Z',
  waitForConnections: true,
  connectionLimit: 10
});

// Helper for long downtimes
function splitDowntimeAcrossDays(startTime, endTime) {
  const result = {};
  const intervalMinutes = 1;

  let current = new Date(startTime);
  const end = new Date(endTime);

  //console.log(`Start Time (UTC): ${current.toISOString()}`);
  //console.log(`End Time (UTC): ${end.toISOString()}`);
  //console.log('--- Splitting by Austin local day (1-minute precision) ---');

  while (current < end) {
    const next = new Date(current.getTime() + intervalMinutes * 60000);

    const austinDate = current.toLocaleDateString('en-CA', {
      timeZone: 'America/Chicago',
    });

    if (!result[austinDate]) {
      result[austinDate] = 0;
    }

    result[austinDate] += intervalMinutes;
    current = next;
  }

  return result;
}

// Helper to split maintenance downtime by shift, using Austin local time
// Helper to split maintenance downtime by shift, using Austin local time
// Converts a UTC or local date to a Date object interpreted in Austin local time (CST/CDT)
function toAustinDate(date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  });

  const parts = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`);
}

// Returns the number of minutes since midnight in Austin time
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Splits a downtime interval into shift buckets for a single Austin day
function splitDowntimeByShiftWithinDay(startUTC, endUTC) {
  const shiftTimes = [
    { shift: 'shift3', start: 0, end: 480 },   // 00:00 → 08:00
    { shift: 'shift1', start: 480, end: 960 }, // 08:00 → 16:00
    { shift: 'shift2', start: 960, end: 1440 } // 16:00 → 24:00
  ];

  const result = { shift1Minutes: 0, shift2Minutes: 0, shift3Minutes: 0 };
  let current = toAustinDate(new Date(startUTC));
  const endDate = toAustinDate(new Date(endUTC));

  while (current < endDate) {
    const dayMinutes = minutesSinceMidnight(current);
    const currentShift = shiftTimes.find(s => dayMinutes >= s.start && dayMinutes < s.end);
    if (!currentShift) break;

    const shiftEnd = new Date(current);
    shiftEnd.setHours(Math.floor(currentShift.end / 60));
    shiftEnd.setMinutes(currentShift.end % 60);
    shiftEnd.setSeconds(0);
    shiftEnd.setMilliseconds(0);

    const nextStep = new Date(Math.min(shiftEnd, endDate));
    const minutesInShift = Math.max(0, Math.round((nextStep - current) / (1000 * 60)));

    const shiftKey = `${currentShift.shift}Minutes`;
    result[shiftKey] += minutesInShift;

    current = new Date(nextStep);
  }

  return result;
}

// Main function: splits a downtime across multiple Austin days and shifts
function splitDowntimeAcrossDays(startUTC, endUTC) {
  const result = {};
  let current = new Date(startUTC);
  const end = new Date(endUTC);

  while (current < end) {
    // Determine the Austin local date for the current UTC time
    const austinDate = current.toLocaleDateString('en-CA', {
      timeZone: 'America/Chicago'
    });

    // Initialize if not already present
    if (!result[austinDate]) {
      result[austinDate] = { start: current, end: current };
    }

    result[austinDate].end = new Date(current.getTime() + 60000);
    current = new Date(current.getTime() + 60000);
  }

  // Final output: split by shift for each day
  const final = {};

  for (const [austinDay, { start, end }] of Object.entries(result)) {
    const shiftSplit = splitDowntimeByShiftWithinDay(start, end);
    final[austinDay] = shiftSplit;
  }

  return final;
}

// Export the function to get KPI data
async function getKpiData() {
  const {
    labels,
    planned: plannedDowntimeFromTotal,
    unplanned: unplannedDowntime,
    plannedByShiftMachine,
    unplannedByShiftMachine
  } = await getPlannedAndUnplannedDowntime();
   const today = new Date().toISOString().slice(0, 10);
  const plyCutters = ['PC1', 'PC2', 'PC4', 'PC5', 'PC6', 'PC7', 'PC8', 'PC9', 'PC10'];
  
  // console.log(`\n📅 Downtime today (${today}) per shift and ply cutter:`);
  
  [1, 2, 3].forEach(shiftNum => {
   // console.log(`\n🔹 Shift ${shiftNum}`);
    plyCutters.forEach(pc => {
      const planned = plannedByShiftMachine?.[today]?.[shiftNum]?.[pc] || 0;
      const unplanned = unplannedByShiftMachine?.[today]?.[shiftNum]?.[pc] || 0;
      const total = planned + unplanned;
      if (total > 0) {
       // console.log(`   🛠 ${pc}: Planned = ${planned.toFixed(2)}h, Unplanned = ${unplanned.toFixed(2)}h, Total = ${total.toFixed(2)}h`);
      }
    });
  });
  

    
    return new Promise((resolve, reject) => {
    const sql = `
      SELECT day, shift, plyCutter, program, obj_value, prod_value
      FROM ply_cutter_obj
      WHERE day >= '2025-01-01'
    `;




    db.query(sql, (err, results) => {
      if (err) return reject(err);




      // Initialize containers
      const all = {}; // Global aggregation
      const shift1 = {}, shift2 = {}, shift3 = {}; // Per shift
      const machineMaps = { PC1: {}, PC2: {}, PC4: {}, PC5: {}, PC6: {}, PC7: {}, PC8: {}, PC9: {}, PC10: {} }; // Per machine
      const sortedDatesSet = new Set();

      function getDowntimeHoursFor(day, machine, plannedDowntimeFromTotal, unplannedDowntime) {
        const formattedDay = new Date(day).toISOString().slice(0, 10);
        const plannedArray = plannedDowntimeFromTotal.machines[machine] || [];
        const unplannedArray = unplannedDowntime.machines[machine] || [];
        const idx = plannedDowntimeFromTotal.labels.indexOf(formattedDay);
      
        if (idx === -1) return 0; // No data found → assume 0 downtime
      
        const planned = plannedArray[idx] ?? 0;
        const unplanned = unplannedArray[idx] ?? 0;
      
        return planned + unplanned; // Return downtime in hours
      }
      

      //  Now calculate UNPLANNED = TOTAL - PLANNED
      function subtractDowntime(total, planned) {
          // Consolidate Total and Planned Downtime first
          function consolidateData(data) {
              const consolidated = {
                  values: new Map(),
                  shift1: new Map(),
                  shift2: new Map(),
                  shift3: new Map(),
                  machines: {}
              };
      
              // Init machines
              Object.keys(data.machines).forEach(machine => {
                  consolidated.machines[machine] = new Map();
              });
      
              data.labels.forEach((day, idx) => {
                  const formattedDay = new Date(day).toISOString().slice(0, 10);
      
                  consolidated.values.set(formattedDay, (consolidated.values.get(formattedDay) || 0) + (data.values[idx] || 0));
                  consolidated.shift1.set(formattedDay, (consolidated.shift1.get(formattedDay) || 0) + (data.shift1?.[idx] || 0));
                  consolidated.shift2.set(formattedDay, (consolidated.shift2.get(formattedDay) || 0) + (data.shift2?.[idx] || 0));
                  consolidated.shift3.set(formattedDay, (consolidated.shift3.get(formattedDay) || 0) + (data.shift3?.[idx] || 0));
      
                  Object.keys(data.machines).forEach(machine => {
                      consolidated.machines[machine].set(formattedDay, (consolidated.machines[machine].get(formattedDay) || 0) + (data.machines[machine]?.[idx] || 0));
                  });
              });
      
              return consolidated;
          }
      
          const totalConsolidated = consolidateData(total);
          const plannedConsolidated = consolidateData(planned);
      
          // Build the list of all unique days
          const allDaysSet = new Set([
              ...Array.from(totalConsolidated.values.keys()),
              ...Array.from(plannedConsolidated.values.keys())
          ]);
          const allDays = Array.from(allDaysSet).sort();
      
          const result = {
              labels: [],
              values: [],
              shift1: [],
              shift2: [],
              shift3: [],
              machines: {}
          };
      
          // Init machines
          Object.keys(total.machines).forEach(machine => {
              result.machines[machine] = [];
          });
      
          // For each day, subtract correctly
          allDays.forEach(day => {
            result.labels.push(day);
        
            const totalVal = totalConsolidated.values.get(day);
            const plannedVal = plannedConsolidated.values.get(day) || 0;
            if (totalVal == null) {
                result.values.push(null);
            } else {
                result.values.push(Math.max(0, totalVal - plannedVal));
            }
        
            const totalShift1 = totalConsolidated.shift1.get(day);
            const plannedShift1 = plannedConsolidated.shift1.get(day) || 0;
            if (totalShift1 == null) {
                result.shift1.push(null);
            } else {
                result.shift1.push(Math.max(0, totalShift1 - plannedShift1));
            }
        
            const totalShift2 = totalConsolidated.shift2.get(day);
            const plannedShift2 = plannedConsolidated.shift2.get(day) || 0;
            if (totalShift2 == null) {
                result.shift2.push(null);
            } else {
                result.shift2.push(Math.max(0, totalShift2 - plannedShift2));
            }
        
            const totalShift3 = totalConsolidated.shift3.get(day);
            const plannedShift3 = plannedConsolidated.shift3.get(day) || 0;
            if (totalShift3 == null) {
                result.shift3.push(null);
            } else {
                result.shift3.push(Math.max(0, totalShift3 - plannedShift3));
            }
        
            Object.keys(result.machines).forEach(machine => {
                const totalMachineVal = totalConsolidated.machines[machine]?.get(day);
                const plannedMachineVal = plannedConsolidated.machines[machine]?.get(day) || 0;
                if (totalMachineVal == null) {
                    result.machines[machine].push(null);
                } else {
                    result.machines[machine].push(Math.max(0, totalMachineVal - plannedMachineVal));
                }
            });
        });
        
      
          return result;
      }
      
      


      //  Corrective Maintenance Rate (%) using plannedDowntimeFromTotal and unplannedDowntime directly
      const correctiveMaintenanceRate = {
        labels: labels,
        values: labels.map((day, idx) => {
          const planned = plannedDowntimeFromTotal.values[idx] ?? 0;
          const unplanned = unplannedDowntime.values[idx] ?? 0;
          const sum = planned + unplanned;
          if (planned === 0 && unplanned === 0) return null;
          const rate = (unplanned * 100) / sum;          
          return Math.min(rate, 100).toFixed(1);

        }),
        shift1: labels.map((day, idx) => {
          const planned = plannedDowntimeFromTotal.shift1[idx] ?? 0;
          const unplanned = unplannedDowntime.shift1[idx] ?? 0;
          const sum = planned + unplanned;
          if (planned === 0 && unplanned === 0) return null;
          const rate = (unplanned * 100) / sum;
          return Math.min(rate, 100).toFixed(1);

        }),
        shift2: labels.map((day, idx) => {
          const planned = plannedDowntimeFromTotal.shift2[idx] ?? 0;
          const unplanned = unplannedDowntime.shift2[idx] ?? 0;
          const sum = planned + unplanned;
          if (planned === 0 && unplanned === 0) return null;
          const rate = (unplanned * 100) / sum;
          return Math.min(rate, 100).toFixed(1);
        }),
        shift3: labels.map((day, idx) => {
          const planned = plannedDowntimeFromTotal.shift3[idx] ?? 0;
          const unplanned = unplannedDowntime.shift3[idx] ?? 0;
          const sum = planned + unplanned;
          if (planned === 0 && unplanned === 0) return null;
          const rate = (unplanned * 100) / sum;
          return Math.min(rate, 100).toFixed(1);

        }),
        machines: {}
      };
      
      
      
      // Then for each machine
      Object.keys(plannedDowntimeFromTotal.machines).forEach(machine => {
        correctiveMaintenanceRate.machines[machine] = labels.map((day, idx) => {
          const plannedRaw = plannedDowntimeFromTotal.machines[machine]?.[idx];
          const unplannedRaw = unplannedDowntime.machines[machine]?.[idx];
      
          // ✅ Si les deux sont undefined/null, on ignore
          if (plannedRaw == null && unplannedRaw == null) return null;
      
          const planned = plannedRaw ?? 0;
          const unplanned = unplannedRaw ?? 0;
          const sum = planned + unplanned;
      
          if (sum === 0) return null;
      
          const rate = (unplanned * 100) / sum;
          return Math.min(rate, 100).toFixed(1);
        });
      });
      
       




      // Calculate Availability (global, by day)
      const numberOfMachines = 9;
      const fullDayHours = 24;
      const shiftHours = 8;
      const totalHoursAvailable = numberOfMachines * fullDayHours; // 216h available per day

      // --- Group downtimes by day ---
      const dailyDowntime = {};

      labels.forEach((day, index) => {
        const plannedRaw = plannedDowntimeFromTotal.values[index];
        const unplannedRaw = unplannedDowntime.values[index];
      
        const planned = (typeof plannedRaw === 'number' && !isNaN(plannedRaw)) ? plannedRaw : 0;
        const unplanned = (typeof unplannedRaw === 'number' && !isNaN(unplannedRaw)) ? unplannedRaw : 0;
        
        const downtime = planned + unplanned;
        dailyDowntime[day] = downtime;
      });
      
      

      function computeShiftAvailability(plannedArray, unplannedArray, shiftHours, numberOfMachines) {
        const raw = [];
        const rounded = [];
      
        for (let i = 0; i < plannedArray.length; i++) {
          const planned = plannedArray[i] || 0;
          const unplanned = unplannedArray[i] || 0;
          const day = plannedDowntimeFromTotal.labels[i]; // use same label index
          const totalProd = dailyProdMap[day] || 0;
          const dayOfWeek = new Date(day).getDay();

          if ((dayOfWeek === 0 || dayOfWeek === 6) && totalProd === 0) {
            raw.push(null);
            rounded.push(null);
            continue;
          }

          const totalDowntime = planned + unplanned;
          if (totalDowntime == null) {
            raw.push(null);
            rounded.push(null);
          } else {
            const capped = Math.min(totalDowntime, numberOfMachines * shiftHours);
            const percent = ((numberOfMachines * shiftHours - capped) * 100) / (numberOfMachines * shiftHours);
            raw.push(percent);
            rounded.push(+percent.toFixed(1));
          }
          
        }
      
        return { raw, rounded };
      }
      
      

      // Construct the Availability KPI object
      const dailyProdMap = {};
      results.forEach(({ day, prod_value }) => {
        const austinDate = new Date(new Date(day).toLocaleString("en-US", { timeZone: "America/Chicago" }));
        const dayStr = austinDate.toISOString().split("T")[0];
        if (!dailyProdMap[dayStr]) dailyProdMap[dayStr] = 0;
        dailyProdMap[dayStr] += prod_value || 0;
      });


      

      // Compute shift-level availability (raw + rounded)
      const shift1Avail = computeShiftAvailability(plannedDowntimeFromTotal.shift1, unplannedDowntime.shift1, shiftHours, numberOfMachines);
      const shift2Avail = computeShiftAvailability(plannedDowntimeFromTotal.shift2, unplannedDowntime.shift2, shiftHours, numberOfMachines);
      const shift3Avail = computeShiftAvailability(plannedDowntimeFromTotal.shift3, unplannedDowntime.shift3, shiftHours, numberOfMachines);

      const allDays = results
      .map(r => typeof r.day === 'string' ? r.day : new Date(r.day).toISOString().slice(0, 10))
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort();
    
      
      
      // Construct the Availability KPI object using a unified time axis (allDays)
      const availability = {
        labels: allDays,

        // Compute daily availability (%), skipping weekends with no production
        values: allDays.map(day => {
          const date = new Date(day);
          const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
          const totalProd = dailyProdMap[day] || 0;

          // If weekend with no production, skip the day
          if ((dayOfWeek === 0 || dayOfWeek === 6) && totalProd === 0) return null;

          const dayStr = getAustinDateStringFromISO(day);
          const idx = labels.findIndex(d => getAustinDateStringFromISO(d) === dayStr);

          // Fallback to zero if no entry found
          const planned = idx !== -1 ? plannedDowntimeFromTotal.values[idx] ?? 0 : 0;
          const unplanned = idx !== -1 ? unplannedDowntime.values[idx] ?? 0 : 0;

          const downtime = planned + unplanned;
          const cappedDowntime = Math.min(downtime, totalHoursAvailable);
          const availabilityPercent = ((totalHoursAvailable - cappedDowntime) * 100) / totalHoursAvailable;

          return +availabilityPercent.toFixed(1);
        }),

        // Align shift-level values with allDays
        shift1: allDays.map(day => {
          // Find index in downtime labels
          const idx = labels.findIndex(l => getAustinDateStringFromISO(l) === getAustinDateStringFromISO(day));
          
          // If not found, assume 100% availability (no downtime recorded)
          if (idx === -1) return 100.0;
          
          // Return actual value or 100 if missing
          return shift1Avail.rounded[idx] ?? 100.0;
        }),
        shift2: allDays.map(day => {
          const idx = labels.findIndex(l => getAustinDateStringFromISO(l) === getAustinDateStringFromISO(day));
          if (idx === -1) return 100.0;
          return shift2Avail.rounded[idx] ?? 100.0;
        }),
        shift3: allDays.map(day => {
          const idx = labels.findIndex(l => getAustinDateStringFromISO(l) === getAustinDateStringFromISO(day));
          if (idx === -1) return 100.0;
          return shift3Avail.rounded[idx] ?? 100.0;
        }),
        

        // Raw shift-level data for internal use
        rawShift1: allDays.map(day => {
          const idx = labels.findIndex(l => getAustinDateStringFromISO(l) === getAustinDateStringFromISO(day));
          return idx !== -1 ? shift1Avail.raw[idx] : 100.0;
        }),
        rawShift2: allDays.map(day => {
          const idx = labels.findIndex(l => getAustinDateStringFromISO(l) === getAustinDateStringFromISO(day));
          return idx !== -1 ? shift2Avail.raw[idx] : 100.0;
        }),
        rawShift3: allDays.map(day => {
          const idx = labels.findIndex(l => getAustinDateStringFromISO(l) === getAustinDateStringFromISO(day));
          return idx !== -1 ? shift3Avail.raw[idx] : 100.0;
        }),
        


        machines: {} // Will be populated below
      };

      // Compute machine-level availability, also aligned with allDays
      Object.keys(plannedDowntimeFromTotal.machines).forEach(machine => {
        availability.machines[machine] = allDays.map(day => {
          // Find index in downtime labels
          const idx = labels.findIndex(d => getAustinDateStringFromISO(d) === getAustinDateStringFromISO(day));
        
          // If not found in downtime, assume no downtime
          const planned = idx !== -1 ? plannedDowntimeFromTotal.machines[machine]?.[idx] ?? 0 : 0;
          const unplanned = idx !== -1 ? unplannedDowntime.machines[machine]?.[idx] ?? 0 : 0;
          const downtime = planned + unplanned;
        
          // Get production info for the day
          const dayStr = getAustinDateStringFromISO(day);
          const totalProd = dailyProdMap[dayStr] || 0;
          const dayOfWeek = new Date(`${dayStr}T12:00:00`).getDay();
        
          // If weekend with no production at all, return null
          if ((dayOfWeek === 0 || dayOfWeek === 6) && totalProd === 0) return null;
        
          // If no downtime, return full availability
          if (downtime === 0) return '100.0';
        
          // Compute normal availability
          return ((24 - Math.min(downtime, 24)) * 100 / 24).toFixed(1);
        });
        
        
      });


    

    for (const { day, shift, plyCutter, obj_value, prod_value } of results) {
        let rawDate;

        if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
          rawDate = `${day}T00:00:00Z`; // UTC
        } else if (day instanceof Date) {
          rawDate = day.toISOString(); // direct ISO
        } else {
          console.error("⛔ Invalid 'day' format:", day);
          continue;
        }

        const dayStr = getAustinDateStringFromISO(rawDate);

        sortedDatesSet.add(dayStr);

        if (!all[dayStr]) all[dayStr] = { obj: 0, prod: 0 };
        all[dayStr].obj += obj_value || 0;
        all[dayStr].prod += prod_value || 0;

        const shiftTarget = shift === 1 ? shift1 : shift === 2 ? shift2 : shift3;
        if (!shiftTarget[dayStr]) shiftTarget[dayStr] = { obj: 0, prod: 0 };
        shiftTarget[dayStr].obj += obj_value || 0;
        shiftTarget[dayStr].prod += prod_value || 0;

        if (machineMaps[plyCutter]) {
          if (!machineMaps[plyCutter][dayStr]) machineMaps[plyCutter][dayStr] = { obj: 0, prod: 0 };
          machineMaps[plyCutter][dayStr].obj += obj_value || 0;
          machineMaps[plyCutter][dayStr].prod += prod_value || 0;
        }
      }




      const sortedDates = Array.from(sortedDatesSet).sort();

      // 🔧 Helper to calculate daily achievement %
        function computeAchievementPercentages(dataByDate) {
            return sortedDates.map(date => {
            const entry = dataByDate[date];
            if (!entry || entry.obj === 0) return null;
            const ratio = entry.prod / entry.obj;
            return +(ratio * 100).toFixed(1);
            });
        }
        
        // 📦 Build result
        const productionAchievementKpi = {
            labels: sortedDates,
            values: computeAchievementPercentages(all)
        };
        
        const shiftAchievements = {
            shift1: computeAchievementPercentages(shift1),
            shift2: computeAchievementPercentages(shift2),
            shift3: computeAchievementPercentages(shift3)
        };
        
        const machineAchievements = Object.fromEntries(
            Object.entries(machineMaps).map(([machine, dataByDate]) => {
            return [machine, computeAchievementPercentages(dataByDate)];
            })
        );
   
        // --- Cycle Time (h) KPI inside db.query normal callback ---
        const cyclePrograms = ['1B', '2B', '115B', '9X'];
        const plyCutters = ['PC1', 'PC2', 'PC4', 'PC5', 'PC6', 'PC7', 'PC8', 'PC9'];

        // Initialize containers
        const cycleTimeData = {};
        cyclePrograms.forEach(program => {
          cycleTimeData[program] = {
            avg: [],
            shifts: { shift1: [], shift2: [], shift3: [] },
            machines: { PC1: [], PC2: [], PC4: [], PC5: [], PC6: [], PC7: [], PC8: [], PC9: [] }
          };
        });

        const cycleSql = `
          SELECT day, shift, plyCutter, program, prod_value
          FROM ply_cutter_obj
          WHERE day >= DATE_FORMAT(CURDATE(), '%Y-01-01')
            AND DAYOFWEEK(day) BETWEEN 2 AND 6 -- Only Monday-Friday
        `;

        // Query production data to calculate Cycle Time
        db.query(cycleSql, (cycleErr, cycleResults) => {
          if (cycleErr) return reject(cycleErr);

          // Process each production row
          for (const { day, shift, plyCutter, program, prod_value } of cycleResults) {
            // Validate program and machine
            if (!cyclePrograms.includes(program)) continue;
            if (!plyCutters.includes(plyCutter)) continue;
            if (!prod_value || prod_value === 0) continue;

            const availableTimeHours = (480 - 79) / 60; // Available hours per shift (minus breaks)
            const shiftNum = shift; // 1, 2, or 3
            const dayStr = typeof day === 'string' ? day : new Date(day).toISOString().slice(0, 10);
            const planned = plannedByShiftMachine?.[dayStr]?.[shiftNum]?.[plyCutter] ?? 0;
            const unplanned = unplannedByShiftMachine?.[dayStr]?.[shiftNum]?.[plyCutter] ?? 0;
            const downtimeHours = planned + unplanned;
            
            const producedAssets = prod_value / 6; // 6 kits = 1 asset

            if (producedAssets === 0) continue;

            // Calculate Cycle Time (hours per asset)
            const cycleTime = (availableTimeHours - downtimeHours) / producedAssets;

            // Outlier rejection based on expected cycle time ranges
            if (['1B', '2B', '115B'].includes(program) && (cycleTime < 2 || cycleTime > 4)) continue;
            if (program === '9X' && (cycleTime < 4 || cycleTime > 6.5)) continue;

            // Determine shift
            const shiftKey = shift === 1 ? 'shift1' : shift === 2 ? 'shift2' : 'shift3';

            // Save calculated cycle time
            cycleTimeData[program].avg.push(cycleTime);
            cycleTimeData[program].shifts[shiftKey].push(cycleTime);
            cycleTimeData[program].machines[plyCutter].push(cycleTime);
          }

          // Helper to calculate average of an array
          function average(array) {
            if (!array.length) return null;
            return +(array.reduce((a, b) => a + b, 0) / array.length).toFixed(2);
          }

          // Assemble Cycle Time KPI
          const cycleTimeKpi = {
            labels: cyclePrograms,
            values: cyclePrograms.map(p => average(cycleTimeData[p].avg)),
            shift1: cyclePrograms.map(p => average(cycleTimeData[p].shifts.shift1)),
            shift2: cyclePrograms.map(p => average(cycleTimeData[p].shifts.shift2)),
            shift3: cyclePrograms.map(p => average(cycleTimeData[p].shifts.shift3)),
            machines: {}
          };

          // Build Cycle Time per machine
          plyCutters.forEach(pc => {
            cycleTimeKpi.machines[pc] = cyclePrograms.map(p => average(cycleTimeData[p].machines[pc]));
          });

          // Query machining times to calculate Changeover Time
          const machiningTimesSql = `SELECT program, mt_hours FROM machining_times`;

          db.query(machiningTimesSql, (mtErr, mtResults) => {
            if (mtErr) return reject(mtErr);

            // Create a lookup table for Machining Times
            const mtMap = {};
            mtResults.forEach(({ program, mt_hours }) => {
              mtMap[program] = mt_hours;
            });

            // Assemble Changeover Time KPI
            const changeoverTimeKpi = {
              labels: cyclePrograms,
              values: cyclePrograms.map(p => {
                const ct = cycleTimeKpi.values[cyclePrograms.indexOf(p)];
                const mt = mtMap[p] ?? 0;
                if (ct == null) return null;
                return +(ct - mt).toFixed(2);
              }),
              shift1: cyclePrograms.map(p => {
                const ct = cycleTimeKpi.shift1[cyclePrograms.indexOf(p)];
                const mt = mtMap[p] ?? 0;
                if (ct == null) return null;
                return +(ct - mt).toFixed(2);
              }),
              shift2: cyclePrograms.map(p => {
                const ct = cycleTimeKpi.shift2[cyclePrograms.indexOf(p)];
                const mt = mtMap[p] ?? 0;
                if (ct == null) return null;
                return +(ct - mt).toFixed(2);
              }),
              shift3: cyclePrograms.map(p => {
                const ct = cycleTimeKpi.shift3[cyclePrograms.indexOf(p)];
                const mt = mtMap[p] ?? 0;
                if (ct == null) return null;
                return +(ct - mt).toFixed(2);
              }),
              machines: {}
              
            };

            // Build Changeover Time per machine
            plyCutters.forEach(pc => {
              changeoverTimeKpi.machines[pc] = cyclePrograms.map(p => {
                const ct = cycleTimeKpi.machines[pc][cyclePrograms.indexOf(p)];
                const mt = mtMap[p] ?? 0;
                if (ct == null) return null;
                return +(ct - mt).toFixed(2);
              });
            });

            //  Efficiency (%) Calculation (no rounding)
            const effShift = { shift1: {}, shift2: {}, shift3: {} };
            const effMachine = {};
            const effDay = {};
            const shiftHours = 6.65;

            // Fetch machining times from database and build a lookup table
            db.query(`SELECT program, mt_hours FROM machining_times`, (mtErr, mtRows) => {
              if (mtErr) return reject(mtErr);

              const mtLookup = {};
              mtRows.forEach(({ program, mt_hours }) => {
                mtLookup[program] = mt_hours;
              });

              // Compute efficiency per row of production data
              results.forEach(({ day, shift, plyCutter, program, prod_value }) => {
                const shiftKey = shift === 1 ? 'shift1' : shift === 2 ? 'shift2' : 'shift3';
                const mt = mtLookup[program];
                if (!mt) return;

                // Normalize date
                const dayStr = typeof day === 'string' ? day : new Date(day).toISOString().slice(0, 10);

                const idx = sortedDates.findIndex(d => {
                  const dStr = typeof d === 'string' ? d : new Date(d).toISOString().slice(0, 10);
                  return dStr === dayStr;
                });
                if (idx === -1) return;

                const planned = plannedByShiftMachine?.[dayStr]?.[shift]?.[plyCutter] ?? 0;
                const unplanned = unplannedByShiftMachine?.[dayStr]?.[shift]?.[plyCutter] ?? 0;
                const runtime = shiftHours - (planned + unplanned);
                if (runtime < 1.5) return;

                const assets = prod_value / 6;
                const eff = +(assets * mt / runtime * 100).toFixed(2);
                if (eff > 125) return;

                const cappedEff = eff;

                if (!effShift[shiftKey][dayStr]) effShift[shiftKey][dayStr] = [];
                effShift[shiftKey][dayStr].push(cappedEff);

                if (!effMachine[plyCutter]) effMachine[plyCutter] = {};
                if (!effMachine[plyCutter][dayStr]) effMachine[plyCutter][dayStr] = [];
                effMachine[plyCutter][dayStr].push(cappedEff);
              });

              // Average helper
              const computeAvg = list => list.length ? +(list.reduce((a, b) => a + b, 0) / list.length).toFixed(1) : null;

              // Compute machine-level daily averages
              const effMachineAvg = {};
              Object.keys(effMachine).forEach(machine => {
                effMachineAvg[machine] = {};
                Object.keys(effMachine[machine]).forEach(day => {
                  const values = effMachine[machine][day];
                  if (values?.length) {
                    effMachineAvg[machine][day] = computeAvg(values);
                  }
                });
              });

              // Compute shift-level daily averages and global daily average
              const effShiftAvg = { shift1: {}, shift2: {}, shift3: {} };
              const allDaysSet = new Set(Object.keys(effShift.shift1)
              .concat(Object.keys(effShift.shift2))
              .concat(Object.keys(effShift.shift3)));
            
              allDaysSet.forEach(day => {
                const dayStr = typeof day === 'string' ? day : new Date(day).toISOString().slice(0, 10);

                ['shift1', 'shift2', 'shift3'].forEach(shiftKey => {
                  const list = effShift[shiftKey][dayStr] || [];
                  effShiftAvg[shiftKey][dayStr] = computeAvg(list);
                });

                const dailyValues = ['shift1', 'shift2', 'shift3']
                  .map(s => effShiftAvg[s][dayStr])
                  .filter(v => v != null);

                effDay[dayStr] = computeAvg(dailyValues);
              });

              const efficiencyLabels = Object.keys(effDay).sort();

              const efficiencyKpi = {
                labels: efficiencyLabels,
                values: efficiencyLabels.map(d => effDay[d])
              };

              const shiftEfficiency = {
                shift1: efficiencyLabels.map(d => effShiftAvg.shift1[d] ?? null),
                shift2: efficiencyLabels.map(d => effShiftAvg.shift2[d] ?? null),
                shift3: efficiencyLabels.map(d => effShiftAvg.shift3[d] ?? null)
              };

              const efficiencyKpiPerMachine = {};
              Object.keys(effMachineAvg).forEach(machine => {
                efficiencyKpiPerMachine[machine] = efficiencyLabels.map(d => {
                  const val = effMachineAvg[machine]?.[d];

                  if (val === 0) {
                    // Check if the machine had any runtime that day
                    const hadRuntime = [1, 2, 3].some(shift => {
                      const planned = plannedByShiftMachine?.[d]?.[shift]?.[machine] ?? 0;
                      const unplanned = unplannedByShiftMachine?.[d]?.[shift]?.[machine] ?? 0;
                      return (6.65 - (planned + unplanned)) > 0.1;
                    });
                    return hadRuntime ? 0 : null;
                  }

                  return val ?? null;
                });
              });

              // Replace 0 with null for machines with no activity at all
              Object.keys(efficiencyKpiPerMachine).forEach(machine => {
                efficiencyKpiPerMachine[machine] = efficiencyKpiPerMachine[machine].map(val => val === 0 ? null : val);
              });


              
              const monthlyProdMap = {};
              results.forEach(({ day, prod_value }) => {
                if (!day || prod_value == null) return;
                const dayStr = typeof day === 'string' ? day : new Date(day).toISOString().slice(0, 10);
                const monthKey = dayStr.slice(0, 7);
                monthlyProdMap[monthKey] = (monthlyProdMap[monthKey] || 0) + prod_value;
              });


              const sqlDefects = `SELECT month, defects FROM kpi_yield_data`;
              db.query(sqlDefects, (defectErr, rows) => {
                if (defectErr) return reject(defectErr);

                const defectsMap = {};
                rows.forEach(({ month, defects }) => {
                  defectsMap[month] = defects;
                });

                const now = new Date();
                const currentMonth = now.toISOString().slice(0, 7);
                const yieldLabels = [];
                const yieldValues = [];

                // Calculate past 6 calendar months
                const today = new Date();
                const monthsRetracted = [];
                for (let i = 5; i >= -1; i--) {
                  const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
                  monthsRetracted.push(d.toISOString().slice(0, 7)); // "YYYY-MM"
                }

                // Calculate past 12 calendar months
                const monthsExtended = [];
                for (let i = 11; i >= -1; i--) {
                  const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
                  monthsExtended.push(d.toISOString().slice(0, 7));
                }


                function calculateYieldForMonths(monthList) {
                  return monthList.map(month => {
                    const totalKits = monthlyProdMap[month] || 0;
                    const defects = defectsMap[month] || 0;
                    const assets = totalKits / 6;
                    if (assets === 0) return null;
                    const yieldPercent = ((assets - defects) / assets) * 100;
                    const safeYield = Math.max(0, Math.min(100, yieldPercent));
                    return safeYield.toFixed(1);
                  });
                }
                

                const yieldValuesRetracted = calculateYieldForMonths(monthsRetracted);
                const yieldValuesExtended = calculateYieldForMonths(monthsExtended);

                //OEE
                const oeeKpi = {
                  labels: efficiencyKpi.labels,
                  values: efficiencyKpi.labels.map((label, idx) => {
                    const eff = efficiencyKpi.values[idx];
                    const avail = availability.values[idx];
                    const labelStr = typeof label === 'string' ? label : new Date(label).toISOString().slice(0, 10);
                    const month = labelStr.slice(0, 7); // ✅ safe
                    const yieldIdx = yieldValuesRetracted.findIndex((_, i) => monthsRetracted[i] === month);
                    const yieldVal = yieldValuesRetracted[yieldIdx];
                
                    if (eff == null || avail == null || yieldVal == null) return null;
                    const oee = (eff * avail * yieldVal) / 10000;
                    return oee > 100 ? null : +oee.toFixed(1);
                  })
                };

                const oeeShifts = {
                  shift1: efficiencyKpi.labels.map((label, idx) => {
                    const eff = shiftEfficiency.shift1[idx];
                    const avail = availability.shift1[idx];
                    const yieldVal = yieldValuesRetracted.find((_, i) => 
                      monthsRetracted[i] === (typeof label === 'string' ? label : new Date(label).toISOString().slice(0, 10)).slice(0, 7)
                    );
                    if (eff == null || avail == null || yieldVal == null) return null;
                    const oee = (eff * avail * yieldVal) / 10000;
                    return oee > 100 ? null : +oee.toFixed(1);                  }),
                  shift2: efficiencyKpi.labels.map((label, idx) => {
                    const eff = shiftEfficiency.shift2[idx];
                    const avail = availability.shift2[idx];
                    const yieldVal = yieldValuesRetracted.find((_, i) =>
                      monthsRetracted[i] === (typeof label === 'string' ? label : new Date(label).toISOString().slice(0, 10)).slice(0, 7)
                    );
                    if (eff == null || avail == null || yieldVal == null) return null;
                    const oee = (eff * avail * yieldVal) / 10000;
                    return oee > 100 ? null : +oee.toFixed(1);                  }),
                  shift3: efficiencyKpi.labels.map((label, idx) => {
                    const eff = shiftEfficiency.shift3[idx];
                    const avail = availability.shift3[idx];
                    const yieldVal = yieldValuesRetracted.find((_, i) =>
                      monthsRetracted[i] === (typeof label === 'string' ? label : new Date(label).toISOString().slice(0, 10)).slice(0, 7)
                    );
                    if (eff == null || avail == null || yieldVal == null) return null;
                    const oee = (eff * avail * yieldVal) / 10000;
                    return oee > 100 ? null : +oee.toFixed(1);                  })
                };
                
                const oeeMachines = {};
                Object.keys(efficiencyKpiPerMachine).forEach(machine => {
                  oeeMachines[machine] = efficiencyKpiPerMachine[machine].map((eff, idx) => {
                    const avail = availability.machines[machine]?.[idx];
                    const label = efficiencyKpi.labels[idx];
                    const month = (typeof label === 'string' ? label : new Date(label).toISOString().slice(0, 10)).slice(0, 7);
                    const yieldIdx = yieldValuesRetracted.findIndex((_, i) => monthsRetracted[i] === month);
                    const yieldVal = yieldValuesRetracted[yieldIdx];
                
                    if (eff == null || avail == null || yieldVal == null) return null;
                    const oee = (eff * avail * yieldVal) / 10000;
                    return oee > 100 ? null : +oee.toFixed(1);                  });
                });

                // --- Active Utilization (%) Calculation with DEBUG LOGS ---
                const utilizationDay = {};
                const utilizationShift = { shift1: {}, shift2: {}, shift3: {} };
                const utilizationMachine = {};
                const utilizationDatesSet = new Set();


                for (const { day, shift, plyCutter, program, prod_value } of results) {
                  if (!prod_value || !program || !plyCutter) continue;
                  const mt = mtLookup[program];
                  if (!mt) {
                    console.log(`⚠️ No MT found for program ${program}`);
                    continue;
                  }

                  // Normalize date to UTC format "YYYY-MM-DD"
                  let rawDate;
                  if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
                    rawDate = `${day}T00:00:00Z`;
                  } else if (day instanceof Date) {
                    rawDate = day.toISOString();
                  } else {
                    continue;
                  }

                  const utcDay = rawDate.slice(0, 10); // Match sortedDates
                  utilizationDatesSet.add(utcDay);

                  const assets = prod_value / 6;
                  const utilization = (assets * mt) / 6.65;
                  const cappedUtilization = utilization * 100;
                  if (cappedUtilization > 100) {
                    continue;
                  }

                  const shiftKey = shift === 1 ? 'shift1' : shift === 2 ? 'shift2' : 'shift3';

                  if (!utilizationDay[utcDay]) utilizationDay[utcDay] = [];
                  utilizationDay[utcDay].push(cappedUtilization);

                  if (!utilizationShift[shiftKey][utcDay]) utilizationShift[shiftKey][utcDay] = [];
                  utilizationShift[shiftKey][utcDay].push(cappedUtilization);

                  if (!utilizationMachine[plyCutter]) utilizationMachine[plyCutter] = {};
                  if (!utilizationMachine[plyCutter][utcDay]) utilizationMachine[plyCutter][utcDay] = [];
                  utilizationMachine[plyCutter][utcDay].push(cappedUtilization);

                }

                const avg = arr => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null;

                // Final KPI
                const sortedUtilizationDates = [...utilizationDatesSet].sort();

                const activeUtilizationKpi = {
                  labels: sortedUtilizationDates,
                  values: sortedUtilizationDates.map(d => {
                    const val = avg(utilizationDay[d] || []);
                    return val;
                  }),
                };

                const utilizationShiftKpi = {
                  shift1: sortedDates.map(d => {
                    const val = avg(utilizationShift.shift1[d] || []);
                    return val;
                  }),
                  shift2: sortedDates.map(d => {
                    const val = avg(utilizationShift.shift2[d] || []);
                    return val;
                  }),
                  shift3: sortedDates.map(d => {
                    const val = avg(utilizationShift.shift3[d] || []);
                    return val;
                  })
                };

                const utilizationMachineKpi = {};
                Object.keys(utilizationMachine).forEach(machine => {
                  utilizationMachineKpi[machine] = sortedDates.map(d => {
                    const val = avg(utilizationMachine[machine][d] || []);
                    return val;
                  });
                });


                // KPI Help Request Rate
                const helpRequestSql = `
                  SELECT 
                    request_date AS day,
                    plyCutter,
                    shift,
                    COUNT(*) AS calls
                  FROM help_requests
                  GROUP BY request_date, plyCutter, shift
              `;
              
              
              db.query(helpRequestSql, (err, helpResults) => {
                if (err) return reject(err);
                helpResults.forEach(({ day, plyCutter, shift, calls }) => {
                  const cleanDay = typeof day === 'string' ? day : new Date(day).toISOString().slice(0, 10);
                });
                
              
              
                const helpMap = new Map();            // total calls per day
                const shift1Map = new Map();          // calls per day for shift 1
                const shift2Map = new Map();          // shift 2
                const shift3Map = new Map();          // shift 3
              
                helpResults.forEach(({ day, shift, calls }) => {
                  const d = typeof day === 'string' ? day : new Date(day).toISOString().slice(0, 10);
                  const s = parseInt(shift);
                  const callsInt = Math.round(calls); 
                
                  helpMap.set(d, (helpMap.get(d) || 0) + callsInt);
                  if (s === 1) shift1Map.set(d, (shift1Map.get(d) || 0) + callsInt);
                  if (s === 2) shift2Map.set(d, (shift2Map.get(d) || 0) + callsInt);
                  if (s === 3) shift3Map.set(d, (shift3Map.get(d) || 0) + callsInt);
                });
                


              
                const allHelpDates = new Set([...sortedDates, ...helpResults.map(r => String(r.day).slice(0, 10))]);
                const helpLabels = Array.from(new Set([
                  ...sortedDates.map(d => typeof d === 'string' ? d : d.toISOString().slice(0, 10)),
                  ...helpResults.map(r => typeof r.day === 'string' ? r.day : new Date(r.day).toISOString().slice(0, 10))
                ])).sort();
                
                
                
                
                const helpValues = helpLabels.map(d => helpMap.get(d) || 0);
                const helpShift1 = helpLabels.map(d => shift1Map.get(d) || 0);
                const helpShift2 = helpLabels.map(d => shift2Map.get(d) || 0);
                const helpShift3 = helpLabels.map(d => shift3Map.get(d) || 0);
                

                const machineMap = {
                  PC1: new Map(), PC2: new Map(), PC4: new Map(), PC5: new Map(),
                  PC6: new Map(), PC7: new Map(), PC8: new Map(), PC9: new Map(), PC10: new Map()
                };
                
                helpResults.forEach(({ day, plyCutter, calls }) => {
                  const d = typeof day === 'string' ? day : new Date(day).toISOString().slice(0, 10);
                  if (machineMap.hasOwnProperty(plyCutter)) {
                    const current = machineMap[plyCutter].get(d) || 0;
                    machineMap[plyCutter].set(d, current + calls);
                  }
                });
                
                
                const machinesKpi = {};
                Object.keys(machineMap).forEach(pc => {
                  machinesKpi[pc] = sortedDates.map(date => machineMap[pc].get(date) || 0);
                });
                
                //KPI Help request response time
                const responseTimeSql = `
                  SELECT DATE(request_date) AS day,
                        TIMESTAMPDIFF(SECOND, start_call, end_call) AS response_time_seconds,
                        shift,
                        plyCutter
                  FROM help_requests
                  WHERE start_call IS NOT NULL AND end_call IS NOT NULL
                `;

                db.query(responseTimeSql, (err, responseResults) => {
                  if (err) return reject(err);

                  const globalMap = new Map();
                  const countMap = new Map();
                  const shiftMaps = { shift1: new Map(), shift2: new Map(), shift3: new Map() };
                  const shiftCounts = { shift1: new Map(), shift2: new Map(), shift3: new Map() };
                  const machineMaps = {
                    PC1: new Map(), PC2: new Map(), PC4: new Map(), PC5: new Map(),
                    PC6: new Map(), PC7: new Map(), PC8: new Map(), PC9: new Map(), PC10: new Map()
                  };
                  const machineCounts = {
                    PC1: new Map(), PC2: new Map(), PC4: new Map(), PC5: new Map(),
                    PC6: new Map(), PC7: new Map(), PC8: new Map(), PC9: new Map(), PC10: new Map()
                  };

                  responseResults.forEach(({ day, response_time_seconds, shift, plyCutter }) => {
                    if (response_time_seconds <= 0) return;

                    const d = new Date(day).toISOString().slice(0, 10);
                    const s = `shift${parseInt(shift)}`; // e.g., 'shift1'

                    // global
                    globalMap.set(d, (globalMap.get(d) || 0) + response_time_seconds);
                    countMap.set(d, (countMap.get(d) || 0) + 1);

                    // shift
                    if (shiftMaps[s]) {
                      shiftMaps[s].set(d, (shiftMaps[s].get(d) || 0) + response_time_seconds);
                      shiftCounts[s].set(d, (shiftCounts[s].get(d) || 0) + 1);
                    }

                    // machine
                    if (machineMaps[plyCutter]) {
                      machineMaps[plyCutter].set(d, (machineMaps[plyCutter].get(d) || 0) + response_time_seconds);
                      machineCounts[plyCutter].set(d, (machineCounts[plyCutter].get(d) || 0) + 1);
                    }
                  });


                  const responseLabelSet = new Set([
                    ...sortedDates.map(d => new Date(d).toISOString().slice(0, 10)),
                    ...responseResults.map(r => new Date(r.day).toISOString().slice(0, 10))
                  ]);
                  
                  const responseLabels = Array.from(responseLabelSet).sort();
                  
                    const globalValues = responseLabels.map(d => {
                    const sum = globalMap.get(d) || 0;
                    const count = countMap.get(d) || 0;
                    if (!count) return null;
                    const avg = (sum / count) / 60;
                    return avg > 30 ? 30 : avg < 1 ? +avg.toFixed(2) : +avg.toFixed(1);
                  });

                  const shift1 = responseLabels.map(d => {
                    const sum = shiftMaps.shift1.get(d) || 0;
                    const count = shiftCounts.shift1.get(d) || 0;
                    if (!count) return null;
                    const avg = (sum / count) / 60;
                    return avg > 30 ? 30 : avg < 1 ? +avg.toFixed(2) : +avg.toFixed(1);
                  });

                  const shift2 = responseLabels.map(d => {
                    const sum = shiftMaps.shift2.get(d) || 0;
                    const count = shiftCounts.shift2.get(d) || 0;
                    if (!count) return null;
                    const avg = (sum / count) / 60;
                    return avg > 30 ? 30 : avg < 1 ? +avg.toFixed(2) : +avg.toFixed(1);
                  });

                  const shift3 = responseLabels.map(d => {
                    const sum = shiftMaps.shift3.get(d) || 0;
                    const count = shiftCounts.shift3.get(d) || 0;
                    if (!count) return null;
                    const avg = (sum / count) / 60;
                    return avg > 30 ? 30 : avg < 1 ? +avg.toFixed(2) : +avg.toFixed(1);
                  });

                  const machineValues = {};
                  Object.keys(machineMaps).forEach(pc => {
                    machineValues[pc] = responseLabels.map(d => {
                      const sum = machineMaps[pc].get(d) || 0;
                      const count = machineCounts[pc].get(d) || 0;
                      if (!count) return null;
                      const avg = (sum / count) / 60;
                      return avg > 30 ? 30 : avg < 1 ? +avg.toFixed(2) : +avg.toFixed(1);
                    });
                  });

                  const helpShifts = {
                    shift1: helpShift1,
                    shift2: helpShift2,
                    shift3: helpShift3
                  };

                  
                  
                                                
                             
                  resolve({
                    kpis: {
                      "Production Achievement (%)": productionAchievementKpi,
                      "Planned Downtime (h)": plannedDowntimeFromTotal,
                      "Unplanned Downtime (h)": { labels, ...unplannedDowntime },
                      "Availability (%)": availability,
                      "Corrective Maintenance Rate (%)": correctiveMaintenanceRate,
                      "Cycle Time (h)": cycleTimeKpi,
                      "Changeover Time (h)": changeoverTimeKpi,
                      "Efficiency (%)": efficiencyKpi,
                      "Yield (%)": {
                        labels: monthsRetracted,
                        values: yieldValuesRetracted,
                        extendedLabels: monthsExtended,
                        extendedValues: yieldValuesExtended
                      },
                      "OEE (%)":oeeKpi,
                      "Active Utilization (%)": {
                        labels: sortedDates,
                        values: sortedDates.map(d => avg(utilizationDay[d] || []))
                      },
                      "Help Request Rate (calls/day)": {
                        labels: helpLabels,
                        values: helpValues
                      },
                      "Help Request Response Time (min)": {
                        labels: responseLabels,
                        values: globalValues
                      }
                    },
                    shifts: {
                      "Production Achievement (%)": shiftAchievements,
                      "Planned Downtime (h)": {
                        shift1: plannedDowntimeFromTotal.shift1,
                        shift2: plannedDowntimeFromTotal.shift2,
                        shift3: plannedDowntimeFromTotal.shift3
                      },
                      "Unplanned Downtime (h)": {
                        shift1: unplannedDowntime.shift1,
                        shift2: unplannedDowntime.shift2,
                        shift3: unplannedDowntime.shift3
                      },
                      "Availability (%)": {
                        shift1: availability.shift1,
                        shift2: availability.shift2,
                        shift3: availability.shift3
                      },
                      "Corrective Maintenance Rate (%)": {
                        shift1: correctiveMaintenanceRate.shift1,
                        shift2: correctiveMaintenanceRate.shift2,
                        shift3: correctiveMaintenanceRate.shift3
                      },
                      "Cycle Time (h)": {
                        shift1: cycleTimeKpi.shift1,
                        shift2: cycleTimeKpi.shift2,
                        shift3: cycleTimeKpi.shift3
                      },
                      "Changeover Time (h)": {
                        shift1: changeoverTimeKpi.shift1,
                        shift2: changeoverTimeKpi.shift2,
                        shift3: changeoverTimeKpi.shift3
                      },
                      "Efficiency (%)": shiftEfficiency,
                      "OEE (%)": oeeShifts,
                      "Active Utilization (%)": {
                        shift1: sortedDates.map(d => avg(utilizationShift.shift1[d] || [])),
                        shift2: sortedDates.map(d => avg(utilizationShift.shift2[d] || [])),
                        shift3: sortedDates.map(d => avg(utilizationShift.shift3[d] || []))
                      },
                      "Help Request Rate (calls/day)": helpShifts,

                      "Help Request Response Time (min)" : {
                        shift1,
                        shift2,
                        shift3
                      }
                    },
                    machines: {
                      "Production Achievement (%)": machineAchievements,
                      "Planned Downtime (h)": plannedDowntimeFromTotal.machines,
                      "Unplanned Downtime (h)": unplannedDowntime.machines,
                      "Availability (%)": availability.machines,
                      "Corrective Maintenance Rate (%)": correctiveMaintenanceRate.machines,
                      "Cycle Time (h)": cycleTimeKpi.machines,
                      "Changeover Time (h)": changeoverTimeKpi.machines,
                      "Efficiency (%)": efficiencyKpiPerMachine,
                      "OEE (%)":oeeMachines,
                      "Active Utilization (%)": utilizationMachineKpi,
                      "Help Request Rate (calls/day)" : machinesKpi,
                      "Help Request Response Time (min)" : machineValues
                    }
                  });
                });
              })
            });
          });
        });
      });

        
      console.log("📥 Nombre de résultats SQL = ", results.length);
      if (results.length > 0) {
        console.log("🧾 Exemple de ligne :", results[0]);
      }
    });
  });
}

// Data computation for downtime KPIs
async function getPlannedAndUnplannedDowntime() {
   
  return new Promise((resolve, reject) => {

    
    const sqlIssues = `
      SELECT DATE(date) AS day, shift, downtime, issue_type, plyCutter
      FROM reported_issues
    `;
    const sqlMaintenances = `
      SELECT start_time, end_time, plyCutter, reason
      FROM maintenance_logs
    `;

    // Create two maps: one for Planned, one for Unplanned
    const plannedTotals = new Map();
    const unplannedTotals = new Map();

    const plannedShifts = { shift1: new Map(), shift2: new Map(), shift3: new Map() };
    const unplannedShifts = { shift1: new Map(), shift2: new Map(), shift3: new Map() };

    const plannedMachines = { PC1: new Map(), PC2: new Map(), PC4: new Map(), PC5: new Map(), PC6: new Map(), PC7: new Map(), PC8: new Map(), PC9: new Map(), PC10: new Map() };
    const unplannedMachines = { PC1: new Map(), PC2: new Map(), PC4: new Map(), PC5: new Map(), PC6: new Map(), PC7: new Map(), PC8: new Map(), PC9: new Map(), PC10: new Map() };
    const plannedByShiftMachine = {};   // plannedByShiftMachine[day][shift][machine]
    const unplannedByShiftMachine = {};

    db.query(sqlIssues, (err, issues) => {
      if (err) return reject(err);

      issues.forEach(({ day, shift, downtime, issue_type, plyCutter }) => {
        const downtimeHours = downtime / 60;
        //  console.log(`[Reported Issue Check] Day: ${day}, Ply Cutter: ${plyCutter}, Issue Type: ${issue_type}, Downtime (h): ${(downtime/60).toFixed(2)}`);

        const formattedDay = new Date(day).toISOString().slice(0, 10);

        const isPlanned = issue_type.toLowerCase().includes('meeting');
        const targetTotals = isPlanned ? plannedTotals : unplannedTotals;
        const targetShifts = isPlanned ? plannedShifts : unplannedShifts;
        
        if (plyCutter) {
          const shiftNum = shift;
          const byShiftMachine = isPlanned ? plannedByShiftMachine : unplannedByShiftMachine;
          
        
          if (!byShiftMachine[formattedDay]) byShiftMachine[formattedDay] = {};
          if (!byShiftMachine[formattedDay][shiftNum]) byShiftMachine[formattedDay][shiftNum] = {};
          if (!byShiftMachine[formattedDay][shiftNum][plyCutter]) byShiftMachine[formattedDay][shiftNum][plyCutter] = 0;
        
          byShiftMachine[formattedDay][shiftNum][plyCutter] += downtimeHours;
        }
        

        targetTotals.set(formattedDay, (targetTotals.get(formattedDay) || 0) + downtimeHours);

        if (shift === 1) targetShifts.shift1.set(formattedDay, (targetShifts.shift1.get(formattedDay) || 0) + downtimeHours);
        if (shift === 2) targetShifts.shift2.set(formattedDay, (targetShifts.shift2.get(formattedDay) || 0) + downtimeHours);
        if (shift === 3) targetShifts.shift3.set(formattedDay, (targetShifts.shift3.get(formattedDay) || 0) + downtimeHours);

        if (!isPlanned && plyCutter && unplannedMachines.hasOwnProperty(plyCutter)) {
          const current = unplannedMachines[plyCutter].get(formattedDay) || 0;
          unplannedMachines[plyCutter].set(formattedDay, current + downtimeHours);
        }
        if (isPlanned && plyCutter && plannedMachines.hasOwnProperty(plyCutter)) {
          const current = plannedMachines[plyCutter].get(formattedDay) || 0;
          plannedMachines[plyCutter].set(formattedDay, current + downtimeHours);
        }
        
      });

      db.query(sqlMaintenances, (err, maintenances) => {
        if (err) return reject(err);
        const alreadyProcessed = new Set();

        maintenances.forEach(({ start_time, end_time, plyCutter, reason }) => {
          const key = `${plyCutter}-${start_time}-${end_time}`;
          if (alreadyProcessed.has(key)) return;
          alreadyProcessed.add(key);

          const splitted = splitDowntimeAcrossDays(new Date(start_time), new Date(end_time));

          Object.entries(splitted).forEach(([day, shiftData]) => {
            const formattedDay = new Date(day).toISOString().slice(0, 10);
            const isPlanned = reason.includes('PM');
          
            const targetTotals = isPlanned ? plannedTotals : unplannedTotals;
            const targetShifts = isPlanned ? plannedShifts : unplannedShifts;
            const targetMachines = isPlanned ? plannedMachines : unplannedMachines;
            const byShiftMachine = isPlanned ? plannedByShiftMachine : unplannedByShiftMachine;
          
            const totalMinutes = shiftData.shift1Minutes + shiftData.shift2Minutes + shiftData.shift3Minutes;
            const totalHours = totalMinutes / 60;
          
            targetTotals.set(formattedDay, (targetTotals.get(formattedDay) || 0) + totalHours);
          
            ['shift1', 'shift2', 'shift3'].forEach((key, i) => {
              const minutes = shiftData[key + 'Minutes'];
              const hours = minutes / 60;
              const shiftNum = i + 1;
          
              targetShifts[key].set(formattedDay, (targetShifts[key].get(formattedDay) || 0) + hours);
          
              if (!byShiftMachine[formattedDay]) byShiftMachine[formattedDay] = {};
              if (!byShiftMachine[formattedDay][shiftNum]) byShiftMachine[formattedDay][shiftNum] = {};
              if (!byShiftMachine[formattedDay][shiftNum][plyCutter]) byShiftMachine[formattedDay][shiftNum][plyCutter] = 0;
          
              byShiftMachine[formattedDay][shiftNum][plyCutter] += hours;
            });
          
            // Total per machine
            if (targetMachines.hasOwnProperty(plyCutter)) {
              const current = targetMachines[plyCutter].get(formattedDay) || 0;
              targetMachines[plyCutter].set(formattedDay, current + totalHours);
            }
          });
          
        });

        const allDays = new Set([...plannedTotals.keys(), ...unplannedTotals.keys()]);
        const sortedDays = Array.from(allDays).sort();
        
        // Output BOTH planned and unplanned nicely
        resolve({
          labels: sortedDays,
          planned: {
            labels: sortedDays,
            values: sortedDays.map(day => +(plannedTotals.get(day) || 0).toFixed(2)),
            shift1: sortedDays.map(day => +(plannedShifts.shift1.get(day) || 0).toFixed(2)),
            shift2: sortedDays.map(day => +(plannedShifts.shift2.get(day) || 0).toFixed(2)),
            shift3: sortedDays.map(day => +(plannedShifts.shift3.get(day) || 0).toFixed(2)),
            machines: Object.fromEntries(Object.entries(plannedMachines).map(([machine, map]) => [machine, sortedDays.map(day => +(map.get(day) || 0).toFixed(2))]))
          },
          unplanned: {
            labels: sortedDays,
            values: sortedDays.map(day => +(unplannedTotals.get(day) || 0).toFixed(2)),
            shift1: sortedDays.map(day => +(unplannedShifts.shift1.get(day) || 0).toFixed(2)),
            shift2: sortedDays.map(day => +(unplannedShifts.shift2.get(day) || 0).toFixed(2)),
            shift3: sortedDays.map(day => +(unplannedShifts.shift3.get(day) || 0).toFixed(2)),
            machines: Object.fromEntries(Object.entries(unplannedMachines).map(([machine, map]) => [
              machine,
              sortedDays.map(day => Math.min(+(map.get(day) || 0).toFixed(2), 24))
            ]))
          },
          plannedByShiftMachine,
          unplannedByShiftMachine
        });
      });
    });
  });
}

// Get preferences
router.get('/api/preferences', (req, res) => {
    db.query('SELECT * FROM kpi_preferences WHERE id = 1', (err, results) => {
      if (err) {
        console.error('Failed to get preferences:', err);
        return res.status(500).send('Error');
      }
      if (results.length === 0) return res.json(null);
      res.json(results[0]);
    });
});
  
// Save preferences
router.post('/api/preferences', (req, res) => {
  const { thresholds, goals, highlights } = req.body;

  const sql = `
    INSERT INTO kpi_preferences (id, thresholds, goals, highlights)
    VALUES (1, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      thresholds = VALUES(thresholds),
      goals = VALUES(goals),
      highlights = VALUES(highlights)
  `;

  db.query(sql, [JSON.stringify(thresholds), JSON.stringify(goals), JSON.stringify(highlights)], (err, results) => {
    if (err) {
      console.error('Failed to save preferences:', err);
      return res.status(500).send('Error');
    }
    res.sendStatus(200);
  });
});

router.post('/api/update-machining-times', (req, res) => {
const updatedMTs = req.body; // 

const queries = Object.entries(updatedMTs).map(([program, mt_hours]) => {
  return new Promise((resolve, reject) => {
    const sql = `UPDATE machining_times SET mt_hours = ? WHERE program = ?`;
    db.query(sql, [mt_hours, program], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
});


Promise.all(queries)
  .then(() => res.sendStatus(200))
  .catch(err => {
    console.error('❌ Error updating machining times:', err);
    res.status(500).send('Failed to update MTs.');
  });
});

//Get machining times
router.get('/api/get-machining-times', (req, res) => {
const sql = `SELECT program, mt_hours FROM machining_times`;
db.query(sql, (err, results) => {
  if (err) {
    console.error('❌ Failed to get machining times:', err);
    return res.status(500).send('Error');
  }
  const machiningTimes = {};
  results.forEach(({ program, mt_hours }) => {
    machiningTimes[program] = mt_hours;
  });
  res.json(machiningTimes);
});
});

//Create PDF
router.post('/api/save-summary', async (req, res) => {
  const { html, filename } = req.body;
  if (!html || !filename) return res.status(400).send('Missing data');

  console.log("📄 HTML received for PDF generation:", html); // ← ajoute ça


  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ],
      userDataDir: path.join(PUP_TMP, 'profile')
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfPath = path.join(REPORT_DIR, filename);
    await page.screenshot({ path: 'test_preview.png', fullPage: true }); // debug

    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });

    await browser.close();
    res.sendStatus(200);
  } catch (err) {
    console.error('❌ PDF generation failed:', err);
    res.status(500).send('Failed to create PDF');
  }
});

//Load PDF reports
router.get('/api/reports', (req, res) => {
  fs.readdir(REPORT_DIR, (err, files) => {
    if (err) return res.status(500).json([]);
    const pdfs = files.filter(f => f.endsWith('.pdf')).sort().reverse();
    res.json(pdfs);
  });
});


module.exports = {
  getKpiData,
  router 
};

