/**
 * kpi_production.js – CONFIDENTIAL – PROPERTY OF PARETOPS
 *
 * For production KPI dashboard support, contact: support@paretops.com
 *
 * DESCRIPTION:
 * This script powers the Production KPI dashboard in the ParetOPS platform. It handles the full rendering,
 * comparison, filtering, and analytical layers for all production-related metrics. It supports dynamic
 * overlays (shifts, machines), real-time updates, summary reports, user preferences, and threshold goals.
 *
 * PURPOSE:
 * - Render and manage all KPI cards in both compact and expanded views.
 * - Allow comparison by time range, shift, machine, or selected overlays.
 * - Enable users to highlight specific KPIs and persist their preferences.
 * - Support maintenance of goal thresholds and historical trend tracking.
 * - Provide tooling for executive summary generation, quality/Yield data entry,
 *   cycle/changeover time benchmarking, and report archiving.
 *
 * FEATURES:
 * - Interactive chart rendering via Chart.js (bar + line overlays + annotation).
 * - Auto-scaling Y-axis based on data and goal threshold logic.
 * - Expanded overlays: 7 days, 30 days, 90 days, YTD with annotations.
 * - Supports special KPIs like 'Cycle Time', 'Yield', and 'Changeover Time' with table-based layout.
 * - Defect entry for Yield by month with database persistence.
 * - Executive summary auto-generation as downloadable PDF via backend service.
 * - Real-time updates from the backend via `/api/kpi`, `/api/maintenance/kpi`.
 *
 * DEPLOYMENT:
 * - Linked from `production_kpi.html`
 * - Depends on the following backend routes:
 *   • `/api/kpi`, `/api/maintenance/kpi`
 *   • `/api/preferences`, `/api/get-machining-times`, `/api/update-machining-times`
 *   • `/api/quality-data`, `/api/reports`, `/api/save-summary`
 *
 * DEPENDENCIES:
 * - Chart.js (bar, line overlays)
 * - Chart.js annotation plugin
 * - Bootstrap 4.5 (UI structure and modal styling)
 * - Font Awesome (icons)
 * - utils.js for formatting and helpers
 *
 * AUTHOR:
 * Paulin Colin BANCKAERT — Production KPI Module v3.0.0
 *
 * VERSIONING:
 * - Version-controlled under Git
 * - All updates to KPI logic, chart overlays, goal systems, or report generation must be documented
 */


(() => {

// --- Config & base lists --------------------------------------------------

// Sécurise la lecture de la config globale
const CONFIG = (window.appConfig && typeof window.appConfig === 'object')
  ? window.appConfig
  : {};

// Machines : toujours un tableau (jamais undefined)
const MACHINES = Array.isArray(CONFIG.machines)
  ? CONFIG.machines
  : [];

// Programmes : clés de productionSetup.programs, ou [] si absent
const PROGRAMS = (CONFIG.productionSetup && CONFIG.productionSetup.programs)
  ? Object.keys(CONFIG.productionSetup.programs)
  : [];


// --- KPIs list (inchangé) -------------------------------------------------

window.kpis = [
  { name: 'Planned Downtime (h)' },
  { name: 'Production Achievement (%)' },
  { name: 'Unplanned Downtime (h)' },
  { name: 'Availability (%)' },
  { name: 'Corrective Maintenance Rate (%)' },
  { name: 'Cycle Time (h)' },
  { name: 'Changeover Time (h)' },
  { name: 'Efficiency (%)' },
  { name: 'Yield (%)' },
  { name: 'OEE (%)' },
  { name: 'Active Utilization (%)' },
  { name: 'Help Request Rate (calls/day)' },
  { name: 'Help Request Response Time (min)' }
];


// --- Data containers ------------------------------------------------------

const dataByKpi = {};
const highlights = new Set();
const kpiShiftSelections = {};   // e.g. { "Utilization (%)": ["shift1", "shift2"] }
const kpiMachineSelections = {}; // machines sélectionnées par KPI
const thresholds = {};           // seuils par KPI
const goals = {};                // goals (maximize/minimize) par KPI
const shiftDataByKpi = {};
const machineDataByKpi = {};

const shiftData = {
  shift1: [],
  shift2: [],
  shift3: []
};

// machineData : une entrée vide par machine connue
const machineData = {};
MACHINES.forEach(m => {
  machineData[m] = [];
});


const machiningTimes = {};

let currentKpi = null;
let isExpanded = false;
let currentRange = 7;
let mainChart, expandedChart;
let currentTimeFilter = "week"; // default view
let kpiShiftOverlays = {};   // Will store all shifts per KPI
let kpiMachineOverlays = {}; // Will store all machines per KPI

// Convert an ISO date string to a formatted YYYY-MM-DD date in Austin local time
function getAustinDateStringFromISO(isoString) {
  const austinDate = new Date(new Date(isoString).toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return austinDate.toISOString().split("T")[0];
}

function formatAustinLabel(dateStr) {
  const assumedLocal = new Date(`${dateStr}T00:00:00`);
  const local = new Date(assumedLocal.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const weekday = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][local.getDay()];
  return `${weekday} ${local.getMonth() + 1}/${local.getDate()}`;
}



// Save user preferences (thresholds, goals, highlights) to the backend database
async function saveUserPreferences() {
  try {
    // 🛑 Block if data is missing or obviously corrupted
    if (!thresholds || Object.keys(thresholds).length === 0) {
      console.warn("⚠️ Aborting save: thresholds object is empty or missing.");
      return;
    }

    if (!goals || Object.keys(goals).length === 0) {
      console.warn("⚠️ Aborting save: goals object is empty or missing.");
      return;
    }

    const payload = {
      thresholds,
      goals,
      highlights: Array.from(highlights)
    };

    await fetch('/api/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });


  } catch (err) {
    console.error('❌ Failed to save user preferences:', err);
  }
}

// Load user preferences (thresholds, goals, highlights) from the backend and apply to UI
async function loadUserPreferences() {
  try {
    const response = await fetch('/api/preferences');
    if (!response.ok) return;
    const data = await response.json();
    if (!data) return;
    if (data.thresholds) Object.assign(thresholds, data.thresholds);
    if (data.goals) Object.assign(goals, data.goals);
    if (data.highlights) {
      data.highlights.forEach(kpi => highlights.add(kpi));
    }

    drawKpis();
    updateHighlightGrid();
  } catch (err) {
    console.error('❌ Failed to load user preferences:', err);
  }
}

// Fetch KPI data from production and maintenance endpoints and build the global KPI structure
async function loadRealKpiData() {
  try {

    // 🔄 Fetch production and maintenance KPI data in parallel
    console.time("fetch /api/kpi");
    const mainRes = await fetch('/api/kpi');
    console.timeEnd("fetch /api/kpi");

    console.time("fetch /api/maintenance/kpi");
    const maintRes = await fetch('/api/maintenance/kpi');
    console.timeEnd("fetch /api/maintenance/kpi");

    console.time("mainRes.json()");
    const mainData = await mainRes.json();
    console.timeEnd("mainRes.json()");

    console.time("maintRes.json()");
    const maintData = await maintRes.json();
    console.timeEnd("maintRes.json()");


    // 🛑 Defensive checks before using the data
    if (!mainData || typeof mainData !== 'object') throw new Error("mainData is missing or invalid");
    if (!mainData.kpis || typeof mainData.kpis !== 'object') throw new Error("mainData.kpis is missing or invalid");
    if (!mainData.shifts || typeof mainData.shifts !== 'object') throw new Error("mainData.shifts is missing or invalid");
    if (!mainData.machines || typeof mainData.machines !== 'object') throw new Error("mainData.machines is missing or invalid");
    if (!maintData || typeof maintData !== 'object') throw new Error("maintData is missing or invalid");
    if (!maintData.kpis || typeof maintData.kpis !== 'object') throw new Error("maintData.kpis is missing or invalid");

    // ✅ Merge production KPIs into global storage
    Object.keys(mainData.kpis).forEach(kpiName => {
      dataByKpi[kpiName] = mainData.kpis[kpiName];
    });

    // ✅ Merge maintenance KPIs (may overwrite duplicates)
    Object.keys(maintData.kpis).forEach(kpiName => {
      dataByKpi[kpiName] = maintData.kpis[kpiName];
    });

    // ✅ Prepare per-shift data overlays for each KPI
    kpiShiftOverlays = mainData.shifts;
    Object.keys(mainData.shifts).forEach(kpiName => {
      shiftDataByKpi[kpiName] = {
        shift1: mainData.shifts[kpiName].shift1,
        shift2: mainData.shifts[kpiName].shift2,
        shift3: mainData.shifts[kpiName].shift3
      };
    });

    // ✅ Prepare per-machine data overlays for each KPI
    kpiMachineOverlays = mainData.machines;
    Object.keys(mainData.machines).forEach(kpiName => {
      machineDataByKpi[kpiName] = mainData.machines[kpiName];
    });
    console.log("✅ Loaded KPIs:", Object.keys(dataByKpi));
    Object.entries(dataByKpi).forEach(([name, data]) => {
      console.log(`${name}: values=${Array.isArray(data.values) ? data.values.length : 'none'}`);
    });



  } catch (err) {
    // ❌ Log any unexpected failure in the data loading process
    console.error('❌ Failed to load KPI data:', err);
  }
}

// Render all KPI cards (or a subset) in the dashboard using compact layout
function drawKpis(kpiList = kpis) {
  const container = document.getElementById("kpiContainer");
  if (!container) return;

  if (kpiList === kpis) {
    container.innerHTML = "";
  }

  kpiList.forEach(kpi => {
    const kpiData = dataByKpi[kpi.name];
    if (!kpiData || !Array.isArray(kpiData.values) || kpiData.values.length === 0) return;

    const labels = kpiData.labels;
    const values = kpiData.values;
    const threshold = thresholds[kpi.name];
    const goal = goals[kpi.name] || 'maximize';

    let visibleLabels, visibleData;
    if (kpi.name === 'Yield (%)') {
      visibleLabels = labels;
      visibleData = values;
    } else {
      const today = new Date();
      const past7DaysLabels = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        past7DaysLabels.push(formatShortWeekLabel(d));
      }
      if (kpi.name === 'Production Achievement (%)') {
        console.log("🔍 past7DaysLabels", past7DaysLabels);
      }

      const labelMap = {};
      labels.forEach((l, idx) => {
        const asDate = new Date(`${l}T00:00:00Z`);
        const austinDate = new Date(asDate.toLocaleString("en-US", { timeZone: "America/Chicago" }));

       
      });
      labels.forEach((l, idx) => {

        const assumedLocal = new Date(`${l}T00:00:00`);
        const local = new Date(assumedLocal.toLocaleString("en-US", { timeZone: "America/Chicago" }));

        const weekday = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][local.getDay()];
        const formatted = `${weekday} ${local.getMonth() + 1}/${local.getDate()}`;
        labelMap[formatted] = values[idx];
      });
      if (kpi.name === 'Production Achievement (%)') {
        console.log("🔍 labelMap keys", Object.keys(labelMap));
      }


      visibleLabels = past7DaysLabels;
      visibleData = past7DaysLabels.map(l => labelMap[l] ?? null);
      if (kpi.name === 'Production Achievement (%)') {
        console.log("🔍 visibleData", visibleData);
      }

    }


    // Compute delta between last two non-null visible values
    let lastValid = null, prevValid = null;
    for (let i = visibleData.length - 1; i >= 0; i--) {
      if (visibleData[i] != null) {
        if (lastValid === null) {
          lastValid = visibleData[i];
        } else {
          prevValid = visibleData[i];
          break;
        }
      }
    }
    const delta = (lastValid !== null && prevValid !== null) ? lastValid - prevValid : null;

    let arrow = '→';
    let arrowColor = 'text-secondary';
    if (delta > 0.5) {
      arrow = '↑';
      arrowColor = (goal === 'maximize') ? 'text-success' : 'text-danger';
    } else if (delta < -0.5) {
      arrow = '↓';
      arrowColor = (goal === 'maximize') ? 'text-danger' : 'text-success';
    }

    // Create KPI card wrapper
    const card = document.createElement("div");
    card.className = "kpi-card";

    // Header controls: expand, star, info
    const expandBtn = document.createElement("div");
    expandBtn.className = "expand-btn";
    expandBtn.innerHTML = '<i class="fas fa-expand-arrows-alt"></i>';
    expandBtn.onclick = () => expandKPI(kpi.name);

    const starBtn = document.createElement("div");
    starBtn.className = "star-btn";
    starBtn.innerHTML = '<i class="fas fa-star"></i>';
    starBtn.onclick = () => {
      if (highlights.has(kpi.name)) {
        highlights.delete(kpi.name);
        starBtn.style.color = '';
      } else {
        highlights.add(kpi.name);
        starBtn.style.color = 'gold';
      }
      updateHighlightGrid();
      drawKpis();
      saveUserPreferences();
    };
    if (highlights.has(kpi.name)) starBtn.style.color = 'gold';

    const infoBtn = document.createElement("div");
    infoBtn.className = "info-btn";
    infoBtn.innerHTML = '<i class="fas fa-info-circle"></i>';
    infoBtn.onclick = (event) => {
      event.stopPropagation();
      showInfoBubble(kpi.name, infoBtn);
    };

    // Title and delta row
    const header = document.createElement("div");
    header.className = "w-100 px-1 mb-1 d-flex flex-column";

    const title = document.createElement("div");
    title.className = "kpi-name text-start flex-grow-1";
    title.style.fontSize = "1.05rem";
    title.style.wordBreak = "break-word";
    title.textContent = kpi.name.replace(/\s*\([^)]+\)/, '');

    const secondRow = document.createElement("div");
    secondRow.className = "d-flex justify-content-between align-items-center w-100";
    secondRow.style.fontSize = "0.9rem";
    secondRow.style.marginTop = "-0.3rem";

    const unit = document.createElement("div");
    unit.className = "text-muted fw-bold";
    const match = kpi.name.match(/\(([^)]+)\)/);
    unit.textContent = match ? match[0] : '';

    const numbers = document.createElement("div");
    numbers.className = arrowColor;
    numbers.style.fontWeight = "bold";
    numbers.style.fontSize = "1.05rem";
    numbers.style.whiteSpace = "nowrap";
    numbers.textContent = (delta !== null) ? `${arrow} ${delta.toFixed(1)}%` : 'No data';

    secondRow.appendChild(unit);
    secondRow.appendChild(numbers);
    header.appendChild(title);
    if (!['Cycle Time (h)', 'Changeover Time (h)'].includes(kpi.name)) {
      header.appendChild(secondRow);
    }

    card.appendChild(starBtn);
    card.appendChild(expandBtn);
    card.appendChild(infoBtn);
    card.appendChild(header);

    // Handle table KPIs (cycle time, changeover time)
    if (['Cycle Time (h)', 'Changeover Time (h)'].includes(kpi.name)) {
      const wrapper = document.createElement("div");
      wrapper.style.display = "grid";
      wrapper.style.gridTemplateColumns = "1fr 1fr";
      wrapper.style.gap = "1rem";
      wrapper.style.marginTop = "0.5rem";
      wrapper.style.padding = "0 1rem 1rem 1rem";
      wrapper.style.width = "100%";
      wrapper.style.boxSizing = "border-box";

      const programs = PROGRAMS;
      programs.forEach((program, i) => {
        const cell = document.createElement("div");
        cell.style.background = "#f9f9f9";
        cell.style.border = "1px solid rgba(0, 0, 0, 0.1)";
        cell.style.borderRadius = "10px";
        cell.style.padding = "1.2rem 0.5rem";
        cell.style.boxShadow = "0 0 4px rgba(0,0,0,0.05)";
        cell.style.textAlign = "center";

        const progLabel = document.createElement("div");
        progLabel.textContent = program;
        progLabel.style.fontSize = "2.5rem";
        progLabel.style.fontWeight = "bold";

        const val = document.createElement("div");
        val.textContent = (values[i] != null ? `${values[i].toFixed(2)} h` : "N/A");
        val.style.fontSize = "1.4rem";
        val.style.color = "#444";

        cell.appendChild(progLabel);
        cell.appendChild(val);
        wrapper.appendChild(cell);
      });

      card.appendChild(wrapper);
      container.appendChild(card);
      return;
    }

    // For other KPIs, create the canvas and render chart with overlays
    const canvas = document.createElement("canvas");
    canvas.id = `chart-${kpi.name}`.replace(/[^a-zA-Z0-9]/g, "");
    card.appendChild(canvas);
    container.appendChild(card);

    const ctx = canvas.getContext("2d");
    const rawLabels = kpiData.labels || [];
    const currentShiftData = shiftDataByKpi[kpi.name] || {};
    const currentMachineData = machineDataByKpi[kpi.name] || {};

    const selectedMachines = kpiMachineSelections[kpi.name] || [];
    const selectedShifts = kpiShiftSelections[kpi.name] || [];

    const shiftOverlay = {};
    if (selectedShifts.includes("shift1") && currentShiftData["shift1"])
      shiftOverlay["shift1"] = mapShiftToLabels(rawLabels, currentShiftData["shift1"], visibleLabels, formatShortWeekLabel);
    if (selectedShifts.includes("shift2") && currentShiftData["shift2"])
      shiftOverlay["shift2"] = mapShiftToLabels(rawLabels, currentShiftData["shift2"], visibleLabels, formatShortWeekLabel);
    if (selectedShifts.includes("shift3") && currentShiftData["shift3"])
      shiftOverlay["shift3"] = mapShiftToLabels(rawLabels, currentShiftData["shift3"], visibleLabels, formatShortWeekLabel);

    const machineOverlay = {};
    selectedMachines.forEach(machine => {
      const rawMachineValues = currentMachineData[machine] || [];
      const hasRealData = rawMachineValues.some(val => val != null && val !== 0);
      if (!hasRealData) return;
      const machineLabelToValue = {};
      rawLabels.forEach((l, idx) => {

        const assumedLocal = new Date(`${l}T00:00:00`);
        const local = new Date(assumedLocal.toLocaleString("en-US", { timeZone: "America/Chicago" }));

        const weekday = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][local.getDay()];
        const formatted = `${weekday} ${local.getMonth() + 1}/${local.getDate()}`;
        machineLabelToValue[formatted] = rawMachineValues[idx];
      });
      machineOverlay[machine] = visibleLabels.map(label => machineLabelToValue[label] ?? null);
    });

    renderChart(
      ctx,
      visibleData,
      visibleLabels,
      threshold,
      goal,
      kpi.name,
      selectedShifts,
      selectedMachines,
      shiftOverlay,
      machineOverlay
    );
  });
}

// Render the highlight grid (starred KPIs) with updated charts and info
function updateHighlightGrid() {
  const highlightGrid = document.getElementById("highlightGrid");
  const highlightTitle = document.getElementById("highlightTitle");
  const highlightWrapper = document.getElementById("highlightWrapper");
  highlightGrid.innerHTML = "";

  // Hide section if no KPI is selected
  if (highlights.size === 0) {
    highlightTitle.style.display = "none";
    if (highlightWrapper) highlightWrapper.style.display = "none";
    drawKpis();
    return;
  }

  highlightTitle.style.display = "block";
  if (highlightWrapper) highlightWrapper.style.display = "block";

highlights.forEach(kpiName => {
  const kpiData = dataByKpi[kpiName];
  if (!kpiData || (!Array.isArray(kpiData.values) && !Array.isArray(kpiData.extendedValues))) return;

  const isYield = (kpiName === 'Yield (%)');
  const isTableKpi = ['Cycle Time (h)', 'Changeover Time (h)'].includes(kpiName); // PATCH

  // --- Series selection ---
  // For Yield: monthly (extended). For others: daily labels/values if available.
  const labels = isYield
    ? (kpiData.extendedLabels || kpiData.labels || [])
    : (kpiData.labels || []);
  const values = isYield
    ? (kpiData.extendedValues || kpiData.values || [])
    : (kpiData.values || []);
  const rawLabels = labels;

  // --- Visible window computation ---
  let visibleLabels = [];
  let visibleData = [];
  let delta = null; // default; computed only when we have a time series

  if (isYield) {
    // PATCH: keep monthly and limit to last 7 months
    const take = 7;
    visibleLabels = labels.slice(-take);
    visibleData   = values.slice(-take);

    // Compute delta on last two non-null monthly points
    let lastValid = null, prevValid = null;
    for (let i = visibleData.length - 1; i >= 0; i--) {
      if (visibleData[i] != null) {
        if (lastValid === null) lastValid = visibleData[i];
        else { prevValid = visibleData[i]; break; }
      }
    }
    delta = (lastValid !== null && prevValid !== null) ? (lastValid - prevValid) : null;

  } else if (!isTableKpi) {
    // Existing 7-day behavior for standard KPIs
    const today = new Date();
    const past7Labels = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      past7Labels.push(formatShortWeekLabel(d));
    }

    const labelMap = {};
    (labels || []).forEach((l, idx) => {
      // Defensive: skip if label not parseable
      if (!l) return;
      const assumedLocal = new Date(`${l}T00:00:00`);
      const local = new Date(assumedLocal.toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const weekday = ["Su","Mo","Tu","We","Th","Fr","Sa"][local.getDay()];
      const formatted = `${weekday} ${local.getMonth() + 1}/${local.getDate()}`;
      labelMap[formatted] = values[idx];
    });

    visibleLabels = past7Labels;
    visibleData   = past7Labels.map(l => labelMap[l] ?? null);

    // Delta on daily series
    let lastValid = null, prevValid = null;
    for (let i = visibleData.length - 1; i >= 0; i--) {
      if (visibleData[i] != null) {
        if (lastValid === null) lastValid = visibleData[i];
        else { prevValid = visibleData[i]; break; }
      }
    }
    delta = (lastValid !== null && prevValid !== null) ? (lastValid - prevValid) : null;
  }

  const goal = goals[kpiName] || 'maximize';
  let arrow = '→';
  let arrowColor = 'text-secondary';
  if (delta > 0.5) {
    arrow = '↑';
    arrowColor = (goal === 'maximize') ? 'text-success' : 'text-danger';
  } else if (delta < -0.5) {
    arrow = '↓';
    arrowColor = (goal === 'maximize') ? 'text-danger' : 'text-success';
  }

  // --- Card shell (unchanged) ---
  const card = document.createElement("div");
  card.className = "kpi-card highlighted";

  const expandBtn = document.createElement("div");
  expandBtn.className = "expand-btn";
  expandBtn.innerHTML = '<i class="fas fa-expand-arrows-alt"></i>';
  expandBtn.onclick = () => expandKPI(kpiName);

  const starBtn = document.createElement("div");
  starBtn.className = "star-btn";
  starBtn.innerHTML = '<i class="fas fa-star"></i>';
  starBtn.style.color = 'gold';
  starBtn.onclick = () => {
    highlights.delete(kpiName);
    updateHighlightGrid();
    drawKpis();
    saveUserPreferences();
  };

  const infoBtn = document.createElement("div");
  infoBtn.className = "info-btn";
  infoBtn.innerHTML = '<i class="fas fa-info-circle"></i>';
  infoBtn.onclick = (event) => {
    event.stopPropagation();
    showInfoBubble(kpiName, infoBtn);
  };

  const header = document.createElement("div");
  header.className = "w-100 px-1 mb-1 d-flex flex-column";

  const title = document.createElement("div");
  title.className = "kpi-name text-start flex-grow-1";
  title.style.fontSize = "1.3rem";
  title.style.wordBreak = "break-word";
  title.textContent = kpiName.replace(/\s*\([^)]+\)/, '');
  if (isTableKpi) title.style.marginTop = '1rem';

  const secondRow = document.createElement("div");
  secondRow.className = "d-flex justify-content-between align-items-center w-100";
  secondRow.style.fontSize = "0.9rem";
  secondRow.style.marginTop = "-0.6rem";

  const match = kpiName.match(/\(([^)]+)\)/);
  const unit = document.createElement("div");
  unit.className = "text-muted fw-bold";
  unit.textContent = match ? match[0] : '';

  const numbers = document.createElement("div");
  numbers.className = arrowColor;
  numbers.style.fontWeight = "bold";
  numbers.style.fontSize = "1.05rem";
  numbers.style.whiteSpace = "nowrap";
  numbers.textContent = (delta !== null) ? `${arrow} ${delta.toFixed(1)}%` : 'No data';

  secondRow.appendChild(unit);
  secondRow.appendChild(numbers);
  header.appendChild(title);
  if (!isTableKpi) header.appendChild(secondRow); // keep original rule

  card.appendChild(starBtn);
  card.appendChild(expandBtn);
  card.appendChild(infoBtn);
  card.appendChild(header);

  // --- Table KPIs (short-circuit BEFORE any label remap) ---
  if (isTableKpi) {
    const wrapper = document.createElement("div");
    wrapper.style.display = "grid";
    wrapper.style.gridTemplateColumns = "1fr 1fr";
    wrapper.style.gap = "1rem";
    wrapper.style.marginTop = "0.5rem";
    wrapper.style.padding = "0 1rem 1rem 1rem";
    wrapper.style.width = "100%";
    wrapper.style.boxSizing = "border-box";

    const programs = PROGRAMS;
    programs.forEach((program, i) => {
      const cell = document.createElement("div");
      cell.style.background = "#f9f9f9";
      cell.style.border = "1px solid rgba(0, 0, 0, 0.1)";
      cell.style.borderRadius = "10px";
      cell.style.padding = "1.2rem 0.5rem";
      cell.style.boxShadow = "0 0 4px rgba(0,0,0,0.05)";
      cell.style.textAlign = "center";

      const progLabel = document.createElement("div");
      progLabel.textContent = program;
      progLabel.style.fontSize = "2.5rem";
      progLabel.style.fontWeight = "bold";

      const val = document.createElement("div");
      const v = Array.isArray(values) ? values[i] : null;
      val.textContent = (v != null ? `${Number(v).toFixed(2)} h` : "N/A");
      val.style.fontSize = "1.4rem";
      val.style.color = "#444";

      cell.appendChild(progLabel);
      cell.appendChild(val);
      wrapper.appendChild(cell);
    });

    card.appendChild(wrapper);
    highlightGrid.appendChild(card);
    return; // PATCH: stop here for table KPIs
  }

  // --- Chart for the rest (no overlays for Yield; labels are monthly) ---
  const canvas = document.createElement("canvas");
  canvas.id = `highlight-${kpiName}`.replace(/[^a-zA-Z0-9]/g, "");
  card.appendChild(canvas);
  highlightGrid.appendChild(card);

  const ctx = canvas.getContext("2d");
  const currentShiftData = shiftDataByKpi[kpiName] || {};
  const currentMachineData = machineDataByKpi[kpiName] || {};
  const selectedMachines = isYield ? [] : (kpiMachineSelections[kpiName] || []);
  const selectedShifts   = isYield ? [] : (kpiShiftSelections[kpiName] || []);

  const shiftOverlay = {};
  if (!isYield) {
    if (selectedShifts.includes("shift1") && currentShiftData["shift1"])
      shiftOverlay["shift1"] = mapShiftToLabels(rawLabels, currentShiftData["shift1"], visibleLabels, formatShortWeekLabel);
    if (selectedShifts.includes("shift2") && currentShiftData["shift2"])
      shiftOverlay["shift2"] = mapShiftToLabels(rawLabels, currentShiftData["shift2"], visibleLabels, formatShortWeekLabel);
    if (selectedShifts.includes("shift3") && currentShiftData["shift3"])
      shiftOverlay["shift3"] = mapShiftToLabels(rawLabels, currentShiftData["shift3"], visibleLabels, formatShortWeekLabel);
  }

  const machineOverlay = {};
  if (!isYield) {
    selectedMachines.forEach(machine => {
      const rawMachineValues = currentMachineData[machine] || [];
      const hasRealData = rawMachineValues.some(val => val != null && val !== 0);
      if (!hasRealData) return;
      const machineLabelToValue = {};
      rawLabels.forEach((l, idx) => {
        const assumedLocal = new Date(`${l}T00:00:00`);
        const local = new Date(assumedLocal.toLocaleString("en-US", { timeZone: "America/Chicago" }));
        const weekday = ["Su","Mo","Tu","We","Th","Fr","Sa"][local.getDay()];
        const formatted = `${weekday} ${local.getMonth() + 1}/${local.getDate()}`;
        machineLabelToValue[formatted] = rawMachineValues[idx];
      });
      machineOverlay[machine] = visibleLabels.map(label => machineLabelToValue[label] ?? null);
    });
  }

  renderChart(
    ctx,
    visibleData,
    visibleLabels,
    thresholds[kpiName],
    goal,
    kpiName,
    selectedShifts,
    selectedMachines,
    shiftOverlay,
    machineOverlay
  );
});


}

// Format a 5-day data array (e.g., shift-level data) into weekday labels and values
function getWeekLabelsAndData(dataArray) {
  const fullLabels = ["Mo", "Tu", "We", "Th", "Fr"];
  const today = new Date();
  const day = today.getDay(); // Sunday = 0, Monday = 1...

  const daysCompleted = Math.min(Math.max(day - 1, 0), 4); // Clamp between 0 and 4 (Mon to Thu max)
  const labels = fullLabels;
  const values = [];

  for (let i = 0; i < 5; i++) {
    if (i <= daysCompleted) {
      values.push(dataArray[dataArray.length - (5 - i)]); // Use recent data
    } else {
      values.push(null); // Missing future data
    }
  }

  return { labels, values };
}

// Expand the selected KPI, prepare overlay settings, and load saved user preferences
function expandKPI(name) {
    isExpanded = true;
    currentKpi = name;

    const overlay = document.getElementById("overlay");
    const overlayContent = overlay.querySelector(".overlay-content");

    // Clean up custom blocks and restore base chart layout visibility
    document.getElementById("tableKpiBlock")?.remove();
    document.getElementById("yieldKpiBlock")?.remove();

    document.getElementById("expandedChart").style.display = "";
    document.getElementById("overlayTitle").style.display = "";
    document.querySelector(".overlay-content button.btn-danger")?.style.setProperty('display', '', 'important');
    document.getElementById("thresholdInput").closest(".mt-3").style.display = "";
    document.getElementById("maximize").closest(".form-check-inline").style.display = "";
    document.getElementById("minimize").closest(".form-check-inline").style.display = "";

    document.querySelectorAll('.btn-outline-primary').forEach(btn => btn.style.display = '');
    document.querySelectorAll('label[for^="shift"]').forEach(el => el.closest('.mt-3').style.display = '');
    document.querySelectorAll('.machine-filter').forEach(cb => cb.closest('.form-check-inline').style.display = '');

    // Clean up previous KPI-specific blocks (e.g. table or yield)
    document.getElementById("tableKpiBlock")?.remove();
    document.getElementById("yieldKpiBlock")?.remove();

    overlay.style.display = "flex";

    // Remove dynamic buttons if they exist
    document.getElementById("enterQualityBtn")?.remove();
    document.getElementById("mtOverlay")?.remove();

    // Destroy previous chart if it exists
    if (expandedChart) {
        expandedChart.destroy();
        expandedChart = null;
    }

    // Special handling for Yield or table KPIs — stop here and let them render their own overlay
    // ✅ Handle table KPIs before exiting
    if (name === "Cycle Time (h)" || name === "Changeover Time (h)") {
      const programs = PROGRAMS;
      const machines = MACHINES;
    
      // Build shift table
      let shiftTable = `<h5 class="mt-4">By Shift</h5><table class="table table-sm table-hover table-bordered text-center align-middle"><thead class="table-light"><tr><th>Program</th><th>1st Shift</th><th>2nd Shift</th><th>3rd Shift</th><th>AVG</th></tr></thead><tbody>`;
      programs.forEach((program, idx) => {
        const avg = dataByKpi[name].values?.[idx];
        shiftTable += `<tr><td><strong>${program}</strong></td>`;
        ['shift1', 'shift2', 'shift3'].forEach(shift => {
          const value = dataByKpi[name][shift]?.[idx];
          const color = value != null
            ? ((name === 'Changeover Time (h)' && value > avg) || (name === 'Cycle Time (h)' && value > avg)
              ? 'text-danger' : 'text-success')
            : '';

          shiftTable += `<td class="${color}">${value != null ? value.toFixed(2) : 'N/A'}</td>`;
        });
        shiftTable += `<td><strong>${avg != null ? avg.toFixed(2) : 'N/A'}</strong></td></tr>`;
      });
      shiftTable += `</tbody></table>`;
    
      // Build machine table
      let machineTable = `<h5 class="mt-4">By Machine</h5><table class="table table-sm table-hover table-bordered text-center align-middle"><thead class="table-light"><tr><th>Program</th>${machines.map(pc => `<th>${pc}</th>`).join('')}<th>AVG</th></tr></thead><tbody>`;
      programs.forEach((program, idx) => {
        const avg = dataByKpi[name].values?.[idx];
        machineTable += `<tr><td><strong>${program}</strong></td>`;
        machines.forEach(pc => {
          const value = dataByKpi[name].machines?.[pc]?.[idx];
          const color = value != null
            ? ((name === 'Changeover Time (h)' && value > avg) || (name === 'Cycle Time (h)' && value > avg)
              ? 'text-danger' : 'text-success')
            : '';

          machineTable += `<td class="${color}">${value != null ? value.toFixed(2) : 'N/A'}</td>`;
        });
        machineTable += `<td><strong>${avg != null ? avg.toFixed(2) : 'N/A'}</strong></td></tr>`;
      });
      machineTable += `</tbody></table>`;
    
      // Clean up old table if it exists
      document.getElementById("tableKpiBlock")?.remove();
    
      // Hide graph UI elements
      document.getElementById("expandedChart").style.display = "none";
      document.getElementById("overlayTitle").style.display = "none";
      document.querySelector(".overlay-content button.btn-danger")?.style.setProperty("display", "none", "important");
    
      document.getElementById("thresholdInput").closest(".mt-3").style.display = "none";
      document.getElementById("maximize").closest(".form-check-inline").style.display = "none";
      document.getElementById("minimize").closest(".form-check-inline").style.display = "none";
    
      document.querySelectorAll(".btn-outline-primary").forEach(btn => btn.style.display = "none");
      document.querySelectorAll('label[for^="shift"]').forEach(el => el.closest(".mt-3").style.display = "none");
      document.querySelectorAll(".machine-filter").forEach(cb => cb.closest(".form-check-inline").style.display = "none");
    
      // Create and inject new table block
      const tableWrapper = document.createElement("div");
      tableWrapper.id = "tableKpiBlock";
      tableWrapper.innerHTML = `
      <button class="btn btn-danger float-end" onclick="closeOverlay()">Close</button>
      ${name === 'Changeover Time (h)' ? `
          <button id="mtButton" class="btn btn-secondary float-end me-2" onclick="showMTOverlay()" style="margin-right: 10px;">
            Machining Times
          </button>
        ` : ''}
        <h4>${name}</h4>
        ${shiftTable}
        ${machineTable}
      `;
    
      overlayContent.appendChild(tableWrapper);
    
      return;
    }
    

    // Table KPI was handled above and returned.
    // From this point on, we're dealing with graph-based KPIs → restore chart UI
    document.getElementById("expandedChart").style.display = "";
    document.getElementById("thresholdInput").closest(".mt-3").style.display = "";
    document.getElementById("maximize").closest(".form-check-inline").style.display = "";
    document.getElementById("minimize").closest(".form-check-inline").style.display = "";

    document.querySelectorAll('.btn-outline-primary').forEach(btn => btn.style.display = '');
    document.querySelectorAll('label[for^="shift"]').forEach(el => el.closest('.mt-3').style.display = '');
    document.querySelectorAll('.machine-filter').forEach(cb => cb.closest('.form-check-inline').style.display = '');


    // For all normal chart KPIs, just update the title
    document.getElementById("overlayTitle").innerText = name;

    const existingYieldButton = document.getElementById('enterQualityBtn');
    if (existingYieldButton) existingYieldButton.remove();

    

    // ✅ Always remove any previous MT overlay when switching KPI
    const shiftFilterSection = document.querySelector('label[for="shift1"]').closest('.mt-3');
    const machineFilterSection = document.querySelector('label[for="pc1"]').closest('.mt-3');

    if (name === 'Yield (%)') {
    if (shiftFilterSection) shiftFilterSection.style.display = 'none';
    if (machineFilterSection) machineFilterSection.style.display = 'none';
    } else {
    if (shiftFilterSection) shiftFilterSection.style.display = '';
    if (machineFilterSection) machineFilterSection.style.display = '';
    }

    const existingMTOverlay = document.getElementById('mtOverlay');
    if (existingMTOverlay) existingMTOverlay.remove();

    document.getElementById("overlay").style.display = "flex";
    // Hide time filters for Yield KPI
    const timeButtons = document.querySelectorAll('.btn-outline-primary');
    timeButtons.forEach(btn => {
      btn.style.display = (name === 'Yield (%)') ? 'none' : '';
    });

    document.getElementById("overlayTitle").innerText = name;

    if (name === 'Yield (%)') {
      const overlayContent = document.getElementById("overlay").querySelector(".overlay-content");
      const chartContainer = document.getElementById("expandedChart").getContext("2d");

      // Hide time filters and disable filters
      document.querySelectorAll('.btn-outline-primary').forEach(btn => btn.style.display = 'none');
      ['shift1', 'shift2', 'shift3'].forEach(id => {
        document.getElementById(id).checked = false;
        document.getElementById(id).disabled = true;
      });
      document.querySelectorAll('.machine-filter').forEach(cb => {
        cb.checked = false;
        cb.disabled = true;
      });

      kpiShiftSelections[name] = [];
      kpiMachineSelections[name] = [];

      // Clear toolbar area
      const existingToolbar = document.getElementById('yield-button-row');
      if (existingToolbar) existingToolbar.remove();

      // Prevent duplicate buttons
      if (!document.getElementById('enterQualityBtn')) {
        const enterBtn = document.createElement('button');
        enterBtn.id = 'enterQualityBtn';
        enterBtn.className = 'btn btn-primary mt-3';
        enterBtn.textContent = 'Enter Quality Data';
        enterBtn.onclick = showYieldEditor;
        let yieldBlock = document.getElementById("yieldKpiBlock");
        if (!yieldBlock) {
          yieldBlock = document.createElement("div");
          yieldBlock.id = "yieldKpiBlock";
          overlayContent.appendChild(yieldBlock);
        }
        yieldBlock.appendChild(enterBtn);
      }

      // Clear previous chart if needed
      if (expandedChart) expandedChart.destroy();

      // Draw chart with 12-month view
      const data = dataByKpi['Yield (%)'];
      currentTimeFilter = null;

      const labels = data.extendedLabels;
      const values = data.extendedValues;

      expandedChart = renderChart(chartContainer, values, labels, thresholds[name], goals[name], '', [], [], {}, {}, {});
    }

    if (name === 'Cycle Time (h)' || name === 'Changeover Time (h)') {
        const programs = PROGRAMS;
        const machines = MACHINES;
        const overlayContent = document.getElementById("overlay").querySelector(".overlay-content");

        let shiftTable = `
            <h5 class="mt-4">By Shift</h5>
            <table class="table table-sm table-hover table-bordered text-center align-middle">
                <thead class="table-light">
                    <tr>
                        <th>Program</th>
                        <th>1st Shift</th>
                        <th>2nd Shift</th>
                        <th>3rd Shift</th>
                        <th>AVG</th>
                    </tr>
                </thead>
                <tbody>
        `;

        programs.forEach((program, idx) => {
          const avg = dataByKpi[name].values?.[idx];
          shiftTable += `<tr><td><strong>${program}</strong></td>`;

          ['shift1', 'shift2', 'shift3'].forEach(shift => {
            const value = dataByKpi[name][shift]?.[idx];

            if (value != null) {
              let color = '';
              if (name === 'Changeover Time (h)') {
                color = (value > avg) ? 'text-danger' : 'text-success';
              } else {
                color = (value <= avg) ? 'text-success' : 'text-danger';
              }

              shiftTable += `<td class="${color}">${value.toFixed(2)}</td>`;
            } else {
              shiftTable += `<td>N/A</td>`;
            }
          });

          shiftTable += `<td><strong>${avg != null ? avg.toFixed(2) : 'N/A'}</strong></td></tr>`;
        });


        shiftTable += `</tbody></table>`;

        let machineTable = `
            <h5 class="mt-4">By Machine</h5>
            <table class="table table-sm table-hover table-bordered text-center align-middle">
                <thead class="table-light">
                    <tr>
                        <th>Program</th>
                        ${machines.map(pc => `<th>${pc}</th>`).join('')}
                        <th>AVG</th>
                    </tr>
                </thead>
                <tbody>
        `;

        programs.forEach((program, idx) => {
          const avg = dataByKpi[name].values?.[idx];
          machineTable += `<tr><td><strong>${program}</strong></td>`;

          machines.forEach(pc => {
            const value = dataByKpi[name].machines?.[pc]?.[idx];

            if (value != null) {
              let color = '';
              if (name === 'Changeover Time (h)') {
                color = (value > avg) ? 'text-danger' : 'text-success';
              } else {
                color = (value <= avg) ? 'text-success' : 'text-danger';
              }

              machineTable += `<td class="${color}">${value.toFixed(2)}</td>`;
            } else {
              machineTable += `<td>N/A</td>`;
            }
          });

          machineTable += `<td><strong>${avg != null ? avg.toFixed(2) : 'N/A'}</strong></td></tr>`;
        });


        machineTable += `</tbody></table>`;

        overlayContent.innerHTML = `
            <button class="btn btn-danger float-end" onclick="closeOverlay()">Close</button>
            ${['Cycle Time (h)', 'Changeover Time (h)'].includes(name) ? `
              <button id="mtButton" class="btn btn-secondary float-end me-2" onclick="showMTOverlay()" style="margin-right: 10px;">Machining Times</button>
            ` : ''}
            <h4 id="overlayTitle">${name}</h4>
            ${shiftTable}
            ${machineTable}
        `;


        return; // stop here if Cycle Time
    }

    // For other KPIs, normal chart behavior
    const savedThreshold = thresholds[name];
    document.getElementById("thresholdInput").value = savedThreshold !== undefined ? savedThreshold : '';

    const savedGoal = goals[name];
    if (savedGoal === 'maximize') {
        document.getElementById("maximize").checked = true;
    } else if (savedGoal === 'minimize') {
        document.getElementById("minimize").checked = true;
    } else {
        document.getElementById("maximize").checked = true;
    }

    if (name === 'Changeover Time (h)') {
      const overlayContent = document.querySelector(".overlay-content");
      overlayContent.innerHTML = `
        <button class="btn btn-danger float-end" onclick="closeOverlay()">Close</button>
        <h4 id="overlayTitle">${name}</h4>
        <canvas id="expandedChart"></canvas>
        <div class="mt-3">
          <!-- Your existing threshold inputs and filters -->
          <label for="thresholdInput">Threshold:</label>
          <input type="number" id="thresholdInput" class="form-control" style="width: 100px; display: inline-block;" oninput="updateCharts()">

          <div class="form-check form-check-inline ms-4">
            <input class="form-check-input" type="radio" name="goal" id="maximize" value="maximize" checked onchange="updateCharts()">
            <label class="form-check-label" for="maximize">Maximize</label>
          </div>
          <div class="form-check form-check-inline">
            <input class="form-check-input" type="radio" name="goal" id="minimize" value="minimize" onchange="updateCharts()">
            <label class="form-check-label" for="minimize">Minimize</label>
          </div>

          <!-- etc, the other parts of your overlay (shifts, machines filters, etc.) -->
        </div>
      `;

      const mtBlock = document.createElement('div');
      mtBlock.innerHTML = `
        <div class="mt-4">
          <button class="btn btn-outline-secondary w-100" type="button" data-bs-toggle="collapse" data-bs-target="#mtCollapse" aria-expanded="false" aria-controls="mtCollapse">
            Machining Time (h)
          </button>
          <div class="collapse mt-2" id="mtCollapse">
            <div class="card card-body">
              ${PROGRAMS.map(program => `
                <div class="mb-3">
                  <label class="form-label">${program}:</label>
                  <input type="number" step="0.01" id="mt-${program}" class="form-control" value="${machiningTimes[program] || ''}">
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
      overlayContent.appendChild(mtBlock);

      PROGRAMS.forEach(program => {
        document.getElementById(`mt-${program}`).addEventListener('input', (e) => {
          machiningTimes[program] = parseFloat(e.target.value) || 0;
        });
      });
    }


    // Preload shift data if not already done
    if (!shiftDataByKpi[name]) {
        const emptyWeek = Array(5).fill(null);
        shiftDataByKpi[name] = {
            shift1: kpiShiftOverlays[name]?.shift1 || emptyWeek.slice(),
            shift2: kpiShiftOverlays[name]?.shift2 || emptyWeek.slice(),
            shift3: kpiShiftOverlays[name]?.shift3 || emptyWeek.slice()
        };
    }

    // Preload machine data if not already done
    if (!machineDataByKpi[name]) {
        const emptyWeek = Array(5).fill(null);
        machineDataByKpi[name] = {};
        ["PC1", "PC2", "PC4", "PC5", "PC6", "PC7", "PC8", "PC9"].forEach(pc => {
            machineDataByKpi[name][pc] = kpiMachineOverlays[name]?.[pc] || emptyWeek.slice();
        });
    }

    // Load previous shift and machine selections
    const selectedShifts = kpiShiftSelections[name] || [];
    const selectedMachines = kpiMachineSelections[name] || [];

    document.getElementById("shift1").checked = selectedShifts.includes("shift1");
    document.getElementById("shift2").checked = selectedShifts.includes("shift2");
    document.getElementById("shift3").checked = selectedShifts.includes("shift3");

    document.querySelectorAll('.machine-filter').forEach(cb => {
        cb.checked = selectedMachines.includes(cb.value);
    });

    // Enforce exclusivity between shift and machine filters
    const shifts = ['shift1', 'shift2', 'shift3'];
    const machines = document.querySelectorAll('.machine-filter');

    if (selectedMachines.length > 0) {
        shifts.forEach(id => document.getElementById(id).disabled = true);
        machines.forEach(cb => cb.disabled = false);
    } else if (selectedShifts.length > 0) {
        machines.forEach(cb => cb.disabled = true);
        shifts.forEach(id => document.getElementById(id).disabled = false);
    } else {
        shifts.forEach(id => document.getElementById(id).disabled = false);
        machines.forEach(cb => cb.disabled = false);
    }

    const isSpecial = ['Yield (%)', 'Cycle Time (h)', 'Changeover Time (h)'].includes(name);

    if (!isSpecial) {
      if (!currentTimeFilter) currentTimeFilter = "week"; // ✅ force valeur par défaut
    
      if (currentTimeFilter === "week") {
        setCurrentWeek();
      } else if (currentTimeFilter === "month") {
        setCurrentMonth();
      } else if (currentTimeFilter === "90days") {
        setTimeframe(90);
      } else if (currentTimeFilter === "ytd") {
        setYTD();
      }
    }
    
    

    updateCharts();
}

// Close the expanded KPI overlay and reset filters and UI
function closeOverlay() {
  // Restore time filters when closing
  document.querySelectorAll('.btn-outline-primary').forEach(btn => {
    btn.style.display = '';
  });

  document.getElementById("overlay").style.display = "none";
  // ✅ Restore filter visibility and interactivity
  document.querySelectorAll('.btn-outline-primary').forEach(btn => {
    btn.style.display = '';
  });

  ['shift1', 'shift2', 'shift3'].forEach(id => {
    const cb = document.getElementById(id);
    if (cb) {
      cb.disabled = false;
      cb.checked = false;
    }
  });

  document.querySelectorAll('.machine-filter').forEach(cb => {
    cb.disabled = false;
    cb.checked = false;
  });

  currentKpi = null;
}

// Redraw only the KPI card (small view) for a given KPI name (e.g., after threshold update)
function updateSingleKpiCard(kpiName) {
  const container = document.getElementById("kpiContainer");
  if (!container) return;

  const canvasId = `chart-${kpiName}`.replace(/[^a-zA-Z0-9]/g, "");
  const chartCanvas = document.getElementById(canvasId);
  if (!chartCanvas) return;

  const oldCard = chartCanvas.closest('.kpi-card');
  const oldIndex = [...container.children].indexOf(oldCard);

  if (oldCard) oldCard.remove();

  const target = kpis.find(k => k.name === kpiName);
  if (!target) return;

  // Create a temporary container and render inside it
  const tempContainer = document.createElement("div");
  document.body.appendChild(tempContainer);

  // Temporarily patch drawKpis to draw in temp container
  const originalContainer = document.getElementById("kpiContainer");
  const originalInnerHTML = originalContainer.innerHTML;
  originalContainer.id = "kpiContainer_backup"; // rename original

  tempContainer.id = "kpiContainer"; // hijack ID so drawKpis uses it
  drawKpis([target]);

  // Get the new card and restore everything
  const newCard = tempContainer.firstElementChild;

  tempContainer.remove(); // clean up
  document.getElementById("kpiContainer_backup").id = "kpiContainer";
  document.getElementById("kpiContainer").innerHTML = originalInnerHTML;

  // Insert at correct position
  if (oldIndex >= 0 && oldIndex <= container.children.length) {
    container.insertBefore(newCard, container.children[oldIndex]);
  } else {
    container.appendChild(newCard);
  }
}

// Determine the bar color for each data point based on threshold and goal direction
function getBarColors(data, thresholdValue, goal) {
  return data.map(v => {
    if (isNaN(thresholdValue)) return '#007bff';
    if (goal === 'maximize') return v >= thresholdValue ? '#28a745' : '#dc3545';
    return v <= thresholdValue ? '#28a745' : '#dc3545';
  });
}

// Return an array of currently selected machines (via checkbox filters)
function getSelectedMachines() {
  return [...document.querySelectorAll('.machine-filter')]
    .filter(cb => cb.checked)
    .map(cb => cb.value);
}

// Get the selected machines specific to a given KPI (used for overlay filtering)
function getSelectedMachinesFor(kpiName) {
  return kpiMachineSelections[kpiName] || [];
}

// Show a contextual info bubble explaining a KPI, anchored to the icon element
function showInfoBubble(kpiName, anchorElement) {
  const existing = anchorElement.parentElement.querySelector('.info-bubble');

  // If bubble already exists for this KPI, remove it (toggle off)
  if (existing) {
    existing.remove();
    return;
  }

  // Otherwise, create a new bubble
  const bubble = document.createElement('div');
  bubble.className = 'info-bubble';
  bubble.innerHTML = getKpiExplanation(kpiName);

  anchorElement.parentElement.appendChild(bubble);

  // Clicking outside should still close it
  document.addEventListener('click', function handler(e) {
    if (!bubble.contains(e.target) && !anchorElement.contains(e.target)) {
      bubble.remove();
      document.removeEventListener('click', handler);
    }
  }, { once: true });
}

// Return a description/explanation string for a given KPI name
function getKpiExplanation(kpiName) {
  switch (kpiName) {
    case 'Production Achievement (%)':
      return 'Shows the percentage of production target achieved.<br><i>Formula: (Production ÷ Objective) × 100.</i>';

    case 'Planned Downtime (h)':
      return 'Sum of PM and meeting downtimes.<br>Meetings affect total and shifts, not machines.<br><i>Formula: PM + Meetings.</i>';

    case 'Unplanned Downtime (h)':
       return 'Total downtime minus planned downtime.<br><i>Formula: Total Downtime - Planned Downtime.</i>';

    case 'Availability (%)':
       return 'Measures the percentage of time a machine was available.<br><i>Formula: (24h - Total Downtime) × 100 ÷ 24.</i>';
    
    case 'Corrective Maintenance Rate (%)':
      return 'Percentage of downtime caused by unplanned (corrective) events.<br><i>Formula: (Unplanned Downtime ÷ Total Downtime) × 100</i>';

    case 'Cycle Time (h)':
      return 'Average cycle times per program. <br><i>Formula: Run Time / Assets Produced</i>';

    case 'Changeover Time (h)':
      return 'Measures the average time lost when changing programs, excluding machining operations.<br><i>Formula: Cycle Time – Machining Time</i>';

    case 'Efficiency (%))':
      return 'Measures how well the available production time is used. The tandard time is the Machining Time.<br><i>Formula: (Total Production × Machining Time) ÷ (Planned Time - Total Downtime)';

    case 'Yield (%)':
      return 'Percentage of non-defective assets.<br><i>Formula: ((Produced − Defects) ÷ Produced) × 100</i>';

    case 'OEE (%)':
      return 'Measures overall machine performance in one metric.<br><i>Formula: OEE = Availability × Efficiency × Yield ÷ 10,000</i>';

    case 'Active Utilization (%)':
      return 'Measures how much of the planned production time was actually used for machining.<br><i>Formula: Total Production × Machining Times / Planned Production TIme</i>';

    case 'Efficiency (%)':
      return 'Effective use of runtime for production.<br><i>Formula: (Assets × MT) ÷ Runtime × 100</i>';

    case 'Help Request Rate (calls/day)':
      return 'Number of support calls per day.';

    case 'Help Request Response Time (min)':
      return 'Average time to respond to help requests.<br><i>Formula: AVG(end_call - start_call)</i>';
  
    default:
      return 'No description available yet.';
  }
}

// Format shift-specific data (Shift1, Shift2, etc.) to match visible KPI labels
function formatShiftData(shiftKey, rawLabels, forKpiName = null) {
    let actualShiftKey = shiftKey;

    if ((forKpiName || currentKpi) === "Planned Downtime (h)") {
      actualShiftKey = shiftKey + "_planned";
    }

    const rawShiftValues = shiftData[actualShiftKey];
    const labelToValue = {};

    rawLabels.forEach((dateStr, i) => {
      const formatted = formatShortWeekLabel(new Date(dateStr));
      labelToValue[formatted] = rawShiftValues[i];
    });

    const today = new Date();
    const daysSinceMonday = (today.getDay() + 6) % 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - daysSinceMonday);

    const currentWeekLabels = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      currentWeekLabels.push(formatShortWeekLabel(d));
    }

    return currentWeekLabels.map(l => labelToValue[l] ?? null);
}

// Format a raw shift data array using formatted label dates (for non-expanded charts)
function formatShiftDataFrom(rawShiftValues, rawLabels) {
  const labelToValue = {};

  if (!rawShiftValues) {
    return rawLabels.map(() => null);
  }

  rawLabels.forEach((dateStr, i) => {
    const formatted = new Date(dateStr).toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
    labelToValue[formatted] = rawShiftValues[i];
  });

  const formattedVisibleLabels = rawLabels.map(dateStr =>
    new Date(dateStr).toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" })
  );

  return formattedVisibleLabels.map(l => labelToValue[l] ?? null);
}

// Map a raw shift value array to a set of target display labels using a formatting function
function mapShiftToLabels(rawLabels, rawShiftValues, targetLabels, formatFn) {
  const labelToValue = {};

  if (!rawShiftValues) return targetLabels.map(() => null); // 🔥 added safe guard

  rawLabels.forEach((label, i) => {
    const formatted = formatFn(new Date(`${label}T00:00:00`));
    const value = rawShiftValues[i];
    labelToValue[formatted] = value;
  });

  return targetLabels.map(l => labelToValue[l] ?? null);
}

// Aggregate daily shift data into weekly averages (used for YTD view)
function aggregateShiftWeekly(rawLabels, rawShiftValues, totalWeeks) {
  const startOfYear = new Date(new Date().getFullYear(), 0, 1);
  const weeklySums = {};
  const weeklyCounts = {};

  rawLabels.forEach((label, idx) => {
      const date = new Date(label);
      const weekNumber = Math.floor((date - startOfYear) / (1000 * 60 * 60 * 24 * 7)) + 1;
      const key = `FW${weekNumber}`;

      if (!weeklySums[key]) {
          weeklySums[key] = 0;
          weeklyCounts[key] = 0;
      }

      const value = rawShiftValues[idx];
      if (value !== null && value !== undefined) {
          weeklySums[key] += value;
          weeklyCounts[key] += 1;
      }
  });

  const result = [];
  for (let i = 1; i <= totalWeeks; i++) {
      const week = `FW${i}`;
      if (weeklyCounts[week]) {
          result.push((weeklySums[week] / weeklyCounts[week]).toFixed(1)); // average per week
      } else {
          result.push(null);
      }
  }

  return result;
}

// Render a KPI chart using Chart.js with overlays, thresholds, and annotations
function renderChart(ctx, data, labels, thresholdValue, goal, labelText, selectedShifts = [], selectedMachines = [], shiftOverlayData = {}, machineOverlayData = {}, extraAnnotations = {}) {
    const shiftColors = {
        shift1: 'rgba(255, 99, 132, 1)',
        shift2: 'rgba(54, 162, 235, 1)',
        shift3: 'rgba(255, 206, 86, 1)'
    };

    const machineColors = [
        'rgba(75,192,192,1)', 'rgba(153,102,255,1)', 'rgba(255,159,64,1)',
        'rgba(199,199,199,1)', 'rgba(83,102,255,1)', 'rgba(255,99,255,1)',
        'rgba(255,220,100,1)', 'rgba(0,200,130,1)'
    ];

    const datasets = [
        {
            data: data,
            type: 'bar',
            backgroundColor: getBarColors(data, thresholdValue, goal),
            borderWidth: 1,
            order: 2,
            yAxisID: 'y',
        }
    ];

    // Add shift overlays
    selectedShifts.forEach((shift, idx) => {
        datasets.push({
          label: shift.includes('shift1') ? '1st Shift' :
                  shift.includes('shift2') ? '2nd Shift' :
                  shift.includes('shift3') ? '3rd Shift' :
                  shift, // fallback: if something weird              
            data: shiftOverlayData[shift] || [],
            type: 'line',
            borderColor: shift.includes('shift1') ? shiftColors['shift1'] :
                          shift.includes('shift2') ? shiftColors['shift2'] :
                          shift.includes('shift3') ? shiftColors['shift3'] :
           'black', // fallback
            backgroundColor: shift.includes('shift1') ? shiftColors['shift1'] :
                            shift.includes('shift2') ? shiftColors['shift2'] :
                            shift.includes('shift3') ? shiftColors['shift3'] :
                            'black',

            borderWidth: 2,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: shiftColors[shift],
            pointBackgroundColor: shift.includes('shift1') ? shiftColors['shift1'] :
                                  shift.includes('shift2') ? shiftColors['shift2'] :
                                  shift.includes('shift3') ? shiftColors['shift3'] :
                                  'black',
            pointBorderWidth: 1,
            fill: false,
            spanGaps: false,
            order: 1,
            yAxisID: 'y'
        });
    });

    // Add machine overlays
    selectedMachines.forEach((machine, idx) => {
        datasets.push({
            label: machine,
            data: machineOverlayData[machine] || [],
            type: 'line',
            borderColor: machineColors[idx % machineColors.length],
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 4,
            spanGaps: false,
            fill: false,
            order: 1,
            yAxisID: 'y'
        });
    });
    const safeKpi = currentKpi || labelText || '';

    const config = {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: selectedShifts.length > 0 || selectedMachines.length > 0,
                    position: 'bottom',
                    labels: {
                        boxWidth: 20,
                        usePointStyle: true,
                        pointStyle: 'line',
                        font: { size: 12 },
                        padding: 6,
                        generateLabels: (chart) => {
                            return chart.data.datasets
                                .map((dataset, i) => {
                                    if (!dataset.label) return null;
                                    return {
                                        text: dataset.label,
                                        strokeStyle: dataset.borderColor,
                                        lineWidth: 2,
                                        hidden: !chart.isDatasetVisible(i),
                                        datasetIndex: i,
                                        pointStyle: 'line'
                                    };
                                })
                                .filter(Boolean);
                        }
                    }
                },
                annotation: {
                  annotations: {
                    ...(isNaN(thresholdValue) ? {} : {
                      thresholdLine: {
                        type: 'line',
                        yMin: thresholdValue,
                        yMax: thresholdValue,
                        borderColor: 'red',
                        borderWidth: 2,
                        label: { enabled: false }
                      }
                    }),
                    ...extraAnnotations
                  }
                }
            },

            scales: {
              x: {
                type: 'category',
                ticks: {
                  callback: function (value) {
                    const label = this.getLabelForValue(value);
                    // Format YYYY-MM labels as "Mon 24"
                    if (/^\d{4}-\d{2}$/.test(label)) {
                      const [year, month] = label.split('-');
                      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                      return `${monthNames[+month - 1]} ${year.slice(2)}`;
                    }
                    return label;
                  }
                }
              },
            
              y: {
                // 🔽 Y-axis minimum: always >= 0
               min: (() => {
                  let visible = data.filter(v => typeof v === 'number');

                  Object.values(shiftOverlayData).forEach(arr => {
                    visible = visible.concat(arr.filter(v => typeof v === 'number'));
                  });

                  Object.values(machineOverlayData).forEach(arr => {
                    visible = visible.concat(arr.filter(v => typeof v === 'number'));
                  });

                  if (visible.length === 0) return 0;
                  const minVal = Math.min(...visible);
                  const threshold = !isNaN(thresholdValue) ? thresholdValue : 0;

                  const candidate = Math.min(minVal - 5, threshold - 1);

                  return Math.max(0, Math.min(minVal, candidate));

                })(),


            
                // 🔼 Y-axis maximum: limited by threshold and capped depending on KPI
                max: (() => {
                  // Include all visible values: base + shift overlays + machine overlays
                  let visible = data.map(v => parseFloat(v)).filter(v => !isNaN(v));

                  Object.values(shiftOverlayData).forEach(arr => {
                    visible = visible.concat(arr.map(v => parseFloat(v)).filter(v => !isNaN(v)));
                  });

                  Object.values(machineOverlayData).forEach(arr => {
                    visible = visible.concat(arr.map(v => parseFloat(v)).filter(v => !isNaN(v)));
                  });

                  if (visible.length === 0) return 100;
                
                  const maxVal = Math.max(...visible);
                  const threshold = !isNaN(thresholdValue) ? thresholdValue : 0;
                
                  // A. Data-based cap (limited by +20%)
                  const pad5 = maxVal + 5;
                  const pad20 = maxVal * 1.2;
                  const maxA = Math.min(pad5, pad20);
                
                  // B. Threshold-based cap
                  const maxB = threshold + 1;
                
                  // Final suggestion
                  let candidate = Math.max(maxA, maxB);
                
                  // Normalize name safely
                  const rawName = (currentKpi || labelText || '').trim().toLowerCase();


                  if ([
                    'availability (%)',
                    'efficiency (%)',
                    'oee (%)',
                    'yield (%)',
                    'active utilization (%)',
                    'production achievement (%)'
                  ].includes(rawName)) {
                    const cap = rawName === 'production achievement (%)' ? 130 : 100;
                    candidate = Math.min(candidate, cap);
                  }




                
                                 
                  return candidate;
                })(),
                
            
                // 🧾 Display one decimal place
                ticks: {
                  callback: function (value) {
                    return value.toFixed(1);
                  }
                }
              }
            }
            
            

        },
        plugins: [Chart.registry.getPlugin('annotation')]
    };

    return new Chart(ctx, config);
}
 
// Redraw the chart for the currently expanded KPI using updated threshold or overlay filters
function updateCharts() {
  if (!currentKpi) return;

  const input = document.getElementById("thresholdInput");
  const userThreshold = parseFloat(input.value);
  const goal = document.querySelector('input[name="goal"]:checked').value;

  thresholds[currentKpi] = isNaN(userThreshold) ? NaN : userThreshold;
  goals[currentKpi] = goal;

  const selectedShifts = [];
  if (document.getElementById("shift1").checked) selectedShifts.push("shift1");
  if (document.getElementById("shift2").checked) selectedShifts.push("shift2");
  if (document.getElementById("shift3").checked) selectedShifts.push("shift3");
  kpiShiftSelections[currentKpi] = selectedShifts;

  const selectedMachines = getSelectedMachines();
  kpiMachineSelections[currentKpi] = selectedMachines;

  saveUserPreferences();

  // ✅ Redraw ONLY this KPI's small card
  updateSingleKpiCard(currentKpi);

  // ✅ Redraw ONLY this KPI in the highlight grid (if it's starred)
  updateSingleHighlight(currentKpi);

  if (highlights.has(currentKpi)) updateHighlightGrid();


  // ✅ Redraw ONLY the expanded chart if it's open
  if (isExpanded) {
    if (currentTimeFilter === "week") {
      setCurrentWeek();
    } else if (currentTimeFilter === "month") {
      setCurrentMonth();
    } else if (currentTimeFilter === "90days") {
      setTimeframe(90);
    } else if (currentTimeFilter === "ytd") {
      setYTD();
    }
  }
}

// Redraw the small KPI card for a specific KPI (used after threshold or goal change)
function updateSingleKpiCard(kpiName) {
  const container = document.getElementById("kpiContainer");
  if (!container) return;

  const canvasId = `chart-${kpiName}`.replace(/[^a-zA-Z0-9]/g, "");
  const chartCanvas = document.getElementById(canvasId);
  if (!chartCanvas) return;

  const oldCard = chartCanvas.closest('.kpi-card');
  const oldIndex = [...container.children].indexOf(oldCard);
  if (oldCard) oldCard.remove();

  const target = kpis.find(k => k.name === kpiName);
  if (!target) return;

  // Create a temporary container and draw the new KPI card inside it
  const tempContainer = document.createElement("div");
  tempContainer.style.display = "none";
  document.body.appendChild(tempContainer);
  tempContainer.id = "tempKpiDrawArea";

  const originalId = container.id;
  container.id = "backupContainer";
  tempContainer.id = "kpiContainer"; // hijack the ID so drawKpis uses it

  drawKpis([target]);

  // Grab the new card
  const newCard = tempContainer.firstElementChild;

  // Cleanup: remove temp container and restore original ID
  tempContainer.remove();
  document.getElementById("backupContainer").id = originalId;

  // Reinsert in the same position
  if (oldIndex >= 0 && oldIndex < container.children.length) {
    container.insertBefore(newCard, container.children[oldIndex]);
  } else {
    container.appendChild(newCard);
  }
}

// Redraw only the highlighted version of a specific KPI in the star grid
function updateSingleHighlight(kpiName) {
  if (isExpanded && currentKpi === kpiName) return;
  if (!highlights.has(kpiName)) return;

  const grid = document.getElementById("highlightGrid");
  const canvasId = `highlight-${kpiName}`.replace(/[^a-zA-Z0-9]/g, "");
  const chartCanvas = document.getElementById(canvasId);
  if (!chartCanvas) return;

  const oldCard = chartCanvas.closest('.kpi-card');
  const oldIndex = [...grid.children].indexOf(oldCard);
  if (oldCard) oldCard.remove();

  const temp = document.createElement("div");
  document.body.appendChild(temp);
  temp.id = "highlightGrid";

  const target = kpis.find(k => k.name === kpiName);
  if (!target) return;

  

  const newCard = createHighlightCard(kpiName);

  temp.remove();

  // If drawing failed, fallback to full refresh
  if (!newCard) {
    updateHighlightGrid();
    return;
  }

  if (oldIndex >= 0 && oldIndex < grid.children.length) {
    grid.insertBefore(newCard, grid.children[oldIndex]);
  } else {
    grid.appendChild(newCard);
  }
}

// Format a Date object into a short label format like "Mo 4/21"
function formatShortWeekLabel(date) {
  const local = new Date(date.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const day = local.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const month = local.getMonth() + 1;
  const dateNum = local.getDate();
  const weekday = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][day];
  return `${weekday} ${month}/${dateNum}`;
}


// Set the expanded view to use a custom time window (e.g. last 90 days)
function setTimeframe(days) {
  if (!currentKpi) return;

  const currentShiftData = shiftDataByKpi[currentKpi] || { shift1: [], shift2: [], shift3: [] };
  const currentMachineData = machineDataByKpi[currentKpi] || {};

  if (days === 90) {
    currentTimeFilter = "90days";
    highlightCurrentTimeFilter();
  }

  const today = new Date();
  const pastDate = new Date();
  pastDate.setDate(today.getDate() - days + 1);

  const fullDates = [];
  const displayLabels = [];
  const monthMarkers = [];

  for (let d = new Date(pastDate); d <= today; d.setDate(d.getDate() + 1)) {
    const austin = new Date(d.toLocaleString("en-US", { timeZone: "America/Chicago" }));
    const internalKey = austin.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
    const displayLabel = austin.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    fullDates.push(internalKey);
    displayLabels.push(displayLabel);

    if (austin.getDate() === 1) {
      monthMarkers.push({
        index: fullDates.length - 1,
        name: austin.toLocaleDateString("en-US", { month: "long" })
      });
    }
  }

  const monthAnnotations = {};
  monthMarkers.forEach((marker, idx) => {
    monthAnnotations[`monthLine${idx}`] = {
      type: 'line',
      xMin: marker.index,
      xMax: marker.index,
      borderColor: 'gray',
      borderWidth: 2,
      borderDash: [6, 6],
      label: {
        display: true,
        content: marker.name,
        rotation: -90,
        color: 'gray',
        font: { size: 10, weight: 'bold' },
        position: 'start',
        backgroundColor: 'transparent'
      }
    };
  });

  const kpiData = dataByKpi[currentKpi];
  const { labels, values } = kpiData;

  const labelToValue = {};
  labels.forEach((l, i) => {
    const local = new Date(`${l}T00:00:00`);
    const austin = new Date(local.toLocaleString("en-US", { timeZone: "America/Chicago" }));
    const key = austin.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
    labelToValue[key] = values[i];
  });

  const visibleData = fullDates.map(label => labelToValue[label] ?? null);

  if (expandedChart) expandedChart.destroy();
  const ctx2 = document.getElementById("expandedChart").getContext("2d");

  const rawLabels = kpiData.labels || [];
  const shiftOverlay = {};

  const formatKey = d => {
    const local = new Date(d);
    const austin = new Date(local.toLocaleString("en-US", { timeZone: "America/Chicago" }));
    return austin.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
  };

  ["shift1", "shift2", "shift3"].forEach(shift => {
    if ((kpiShiftSelections[currentKpi] || []).includes(shift) && currentShiftData[shift]) {
      shiftOverlay[shift] = mapShiftToLabels(rawLabels, currentShiftData[shift], fullDates, formatKey);
    }
  });

  const machineOverlay = {};
  const selectedMachines = kpiMachineSelections[currentKpi] || [];
  selectedMachines.forEach(machine => {
    const rawMachineValues = currentMachineData[machine] || [];
    const machineLabelToValue = {};

    rawLabels.forEach((l, i) => {
      const local = new Date(`${l}T00:00:00`);
      const austin = new Date(local.toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const key = austin.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
      machineLabelToValue[key] = rawMachineValues[i];
    });

    machineOverlay[machine] = fullDates.map(label => machineLabelToValue[label] ?? null);
  });

  expandedChart = renderChart(
    ctx2,
    visibleData,
    displayLabels,
    thresholds[currentKpi],
    goals[currentKpi],
    '',
    Object.keys(shiftOverlay),
    Object.keys(machineOverlay),
    shiftOverlay,
    machineOverlay,
    monthAnnotations
  );
}


// Render the last 7 days of KPI data into the expanded chart (default view)
function setCurrentWeek() {
  if (!currentKpi) return;

  const currentShiftData = shiftDataByKpi[currentKpi] || { shift1: [], shift2: [], shift3: [] };
  const currentMachineData = machineDataByKpi[currentKpi] || {};

  currentTimeFilter = "week";
  highlightCurrentTimeFilter();

  const today = new Date();
  const past7Days = [];
  const displayLabels = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);

    const austinDate = new Date(d.toLocaleString("en-US", { timeZone: "America/Chicago" }));
    const internalKey = austinDate.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" }); // ex: 06/04/2025
    const displayLabel = austinDate.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" }); // ex: Wed 6/4

    past7Days.push(internalKey);
    displayLabels.push(displayLabel);
  }

  const kpiData = dataByKpi[currentKpi];
  const { labels, values } = kpiData;

  const labelToValue = {};
  labels.forEach((label, idx) => {
    const local = new Date(`${label}T00:00:00`);
    const austin = new Date(local.toLocaleString("en-US", { timeZone: "America/Chicago" }));
    const key = austin.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
    labelToValue[key] = values[idx];
  });

  const visibleData = past7Days.map(date => labelToValue[date] ?? null);

  if (expandedChart) expandedChart.destroy();
  const ctx2 = document.getElementById("expandedChart").getContext("2d");

  const rawLabels = kpiData.labels || [];
  const shiftOverlay = {};

  const formatKey = d => {
    const local = new Date(d);
    const austin = new Date(local.toLocaleString("en-US", { timeZone: "America/Chicago" }));
    return austin.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
  };

  ["shift1", "shift2", "shift3"].forEach(shift => {
    if ((kpiShiftSelections[currentKpi] || []).includes(shift) && currentShiftData[shift]) {
      shiftOverlay[shift] = mapShiftToLabels(rawLabels, currentShiftData[shift], past7Days, formatKey);
    }
  });

  const machineOverlay = {};
  const selectedMachines = kpiMachineSelections[currentKpi] || [];
  selectedMachines.forEach(machine => {
    const rawMachineValues = currentMachineData[machine] || [];
    const machineLabelToValue = {};

    rawLabels.forEach((l, i) => {
      const local = new Date(`${l}T00:00:00`);
      const austin = new Date(local.toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const key = austin.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
      machineLabelToValue[key] = rawMachineValues[i];
    });

    machineOverlay[machine] = past7Days.map(date => machineLabelToValue[date] ?? null);
  });

  expandedChart = renderChart(
    ctx2,
    visibleData,
    displayLabels,
    thresholds[currentKpi],
    goals[currentKpi],
    'Past 7 days',
    Object.keys(shiftOverlay),
    Object.keys(machineOverlay),
    shiftOverlay,
    machineOverlay
  );
}


// Render the last 30 days of KPI data into the expanded chart
function setCurrentMonth() {
  if (!currentKpi) return;

  const currentShiftData = shiftDataByKpi[currentKpi] || { shift1: [], shift2: [], shift3: [] };
  const currentMachineData = machineDataByKpi[currentKpi] || {};

  currentTimeFilter = "month";
  highlightCurrentTimeFilter();

  const today = new Date();
  const past30Days = [];
  const displayLabels = [];

  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);

    const austinDate = new Date(d.toLocaleString("en-US", { timeZone: "America/Chicago" }));
    const internalKey = austinDate.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
    const displayLabel = austinDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    past30Days.push(internalKey);
    displayLabels.push(displayLabel);
  }

  const kpiData = dataByKpi[currentKpi];
  const { labels, values } = kpiData;

  const labelToValue = {};
  labels.forEach((l, i) => {
    const local = new Date(`${l}T00:00:00`);
    const austin = new Date(local.toLocaleString("en-US", { timeZone: "America/Chicago" }));
    const key = austin.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
    labelToValue[key] = values[i];
  });

  const visibleData = past30Days.map(date => labelToValue[date] ?? null);

  if (expandedChart) expandedChart.destroy();
  const ctx2 = document.getElementById("expandedChart").getContext("2d");

  const rawLabels = kpiData.labels || [];
  const shiftOverlay = {};

  const formatKey = d => {
    const local = new Date(d);
    const austin = new Date(local.toLocaleString("en-US", { timeZone: "America/Chicago" }));
    return austin.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
  };

  ["shift1", "shift2", "shift3"].forEach(shift => {
    if ((kpiShiftSelections[currentKpi] || []).includes(shift) && currentShiftData[shift]) {
      shiftOverlay[shift] = mapShiftToLabels(rawLabels, currentShiftData[shift], past30Days, formatKey);
    }
  });

  const machineOverlay = {};
  const selectedMachines = kpiMachineSelections[currentKpi] || [];
  selectedMachines.forEach(machine => {
    const rawMachineValues = currentMachineData[machine] || [];
    const machineLabelToValue = {};

    rawLabels.forEach((l, i) => {
      const local = new Date(`${l}T00:00:00`);
      const austin = new Date(local.toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const key = austin.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
      machineLabelToValue[key] = rawMachineValues[i];
    });

    machineOverlay[machine] = past30Days.map(date => machineLabelToValue[date] ?? null);
  });

  expandedChart = renderChart(
    ctx2,
    visibleData,
    displayLabels,
    thresholds[currentKpi],
    goals[currentKpi],
    'Past 30 days',
    Object.keys(shiftOverlay),
    Object.keys(machineOverlay),
    shiftOverlay,
    machineOverlay
  );
}


// Render year-to-date weekly-averaged KPI data into the expanded chart
function setYTD() {
  if (!currentKpi) return;

  const currentShiftData = shiftDataByKpi[currentKpi] || { shift1: [], shift2: [], shift3: [] };
  const currentMachineData = machineDataByKpi[currentKpi] || {};

  currentTimeFilter = "ytd";
  highlightCurrentTimeFilter();

  const today = new Date();
  const startOfYear = new Date(today.getFullYear(), 0, 1);
  const now = new Date();
  const totalWeeks = Math.ceil((now - startOfYear) / (1000 * 60 * 60 * 24 * 7));

  const kpiData = dataByKpi[currentKpi];
  const { labels, values } = kpiData;

  const weeklySums = {};
  const weeklyCounts = {};

  labels.forEach((label, idx) => {
    const local = new Date(`${label}T00:00:00`);
    const austin = new Date(local.toLocaleString("en-US", { timeZone: "America/Chicago" }));
    const weekNumber = Math.floor((austin - startOfYear) / (1000 * 60 * 60 * 24 * 7)) + 1;
    const key = `FW${weekNumber}`;

    if (!weeklySums[key]) {
      weeklySums[key] = 0;
      weeklyCounts[key] = 0;
    }

    if (values[idx] !== null && values[idx] !== undefined) {
      weeklySums[key] += parseFloat(values[idx]);
      weeklyCounts[key] += 1;
    }
  });

  const labelsYTD = [];
  const dataYTD = [];

  for (let i = 1; i <= totalWeeks; i++) {
    const week = `FW${i}`;
    labelsYTD.push(week);
    if (weeklyCounts[week] && weeklyCounts[week] > 0) {
      dataYTD.push((weeklySums[week] / weeklyCounts[week]).toFixed(1));
    } else {
      dataYTD.push(null);
    }
  }

  if (expandedChart) expandedChart.destroy();
  const ctx2 = document.getElementById("expandedChart").getContext("2d");

  const rawLabels = kpiData.labels || [];
  const shiftOverlay = {};

  if ((kpiShiftSelections[currentKpi] || []).includes("shift1"))
    shiftOverlay["shift1"] = aggregateShiftWeekly(rawLabels, kpiData.rawShift1 || currentShiftData["shift1"], totalWeeks);

  if ((kpiShiftSelections[currentKpi] || []).includes("shift2"))
    shiftOverlay["shift2"] = aggregateShiftWeekly(rawLabels, kpiData.rawShift2 || currentShiftData["shift2"], totalWeeks);

  if ((kpiShiftSelections[currentKpi] || []).includes("shift3"))
    shiftOverlay["shift3"] = aggregateShiftWeekly(rawLabels, kpiData.rawShift3 || currentShiftData["shift3"], totalWeeks);

  const machineOverlay = {};
  const selectedMachines = kpiMachineSelections[currentKpi] || [];
  selectedMachines.forEach(machine => {
    const rawMachineValues = currentMachineData[machine] || [];
    const weeklyMachineSums = {};
    const weeklyMachineCounts = {};

    rawLabels.forEach((label, idx) => {
      const local = new Date(`${label}T00:00:00`);
      const austin = new Date(local.toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const weekNumber = Math.floor((austin - startOfYear) / (1000 * 60 * 60 * 24 * 7)) + 1;
      const key = `FW${weekNumber}`;

      if (!weeklyMachineSums[key]) {
        weeklyMachineSums[key] = 0;
        weeklyMachineCounts[key] = 0;
      }

      if (rawMachineValues[idx] !== null && rawMachineValues[idx] !== undefined) {
        weeklyMachineSums[key] += parseFloat(rawMachineValues[idx]);
        weeklyMachineCounts[key] += 1;
      }
    });

    const machineWeeklyAverages = [];
    for (let i = 1; i <= totalWeeks; i++) {
      const week = `FW${i}`;
      if (weeklyMachineCounts[week] && weeklyMachineCounts[week] > 0) {
        machineWeeklyAverages.push((weeklyMachineSums[week] / weeklyMachineCounts[week]).toFixed(1));
      } else {
        machineWeeklyAverages.push(null);
      }
    }

    machineOverlay[machine] = machineWeeklyAverages;
  });

  expandedChart = renderChart(
    ctx2,
    dataYTD,
    labelsYTD,
    thresholds[currentKpi],
    goals[currentKpi] || 'maximize',
    `${currentKpi} (YTD)`,
    Object.keys(shiftOverlay),
    Object.keys(machineOverlay),
    shiftOverlay,
    machineOverlay
  );
}


// Render year-to-date weekly-averaged KPI data into the expanded chart
function handleMachineShiftExclusivity() {
  const anyMachineSelected = [...document.querySelectorAll('.machine-filter')].some(cb => cb.checked);

  if (anyMachineSelected) {
    // Disable and uncheck all shifts
    ['shift1', 'shift2', 'shift3'].forEach(id => {
      document.getElementById(id).checked = false;
      document.getElementById(id).disabled = true;
    });
  } else {
    // Re-enable shifts if no machine selected
    ['shift1', 'shift2', 'shift3'].forEach(id => {
      document.getElementById(id).disabled = false;
    });
  }

  updateCharts();
}

// Disable machine filters when a shift is selected, and update the chart accordingly
function handleShiftExclusivity() {
  const anyShiftSelected = ['shift1', 'shift2', 'shift3'].some(id => document.getElementById(id).checked);

  if (anyShiftSelected) {
    // Disable and uncheck all machines
    document.querySelectorAll('.machine-filter').forEach(cb => {
      cb.checked = false;
      cb.disabled = true;
    });
  } else {
    // Re-enable machines if no shift selected
    document.querySelectorAll('.machine-filter').forEach(cb => {
      cb.disabled = false;
    });
  }

  updateCharts();
}

// Visually highlight the currently active time filter button (e.g. 'Past 30 days')
function highlightCurrentTimeFilter() {
  const buttons = document.querySelectorAll('.btn-outline-primary');
  buttons.forEach(btn => btn.classList.remove('active'));

  if (currentTimeFilter === "week") {
    document.querySelector('button[onclick="setCurrentWeek()"]').classList.add('active');
  } else if (currentTimeFilter === "month") {
    document.querySelector('button[onclick="setCurrentMonth()"]').classList.add('active');
  } else if (currentTimeFilter === "90days") {
    document.querySelector('button[onclick="setTimeframe(90)"]').classList.add('active');
  } else if (currentTimeFilter === "ytd") {
    document.querySelector('button[onclick="setYTD()"]').classList.add('active');
  }
}

// Display the Machining Time overlay for modifying cycle time parameters by program
function showMTOverlay() {
  if (currentKpi !== 'Cycle Time (h)' && currentKpi !== 'Changeover Time (h)') return; //  block if wrong KPI
  // Check if already open
  if (document.getElementById('mtOverlay')) return;

  const mtOverlay = document.createElement('div');
  mtOverlay.id = 'mtOverlay';
  mtOverlay.style.position = 'fixed';
  mtOverlay.style.top = '80px';
  mtOverlay.style.right = '50px';
  mtOverlay.style.width = '300px';
  mtOverlay.style.background = 'white';
  mtOverlay.style.border = '1px solid #ccc';
  mtOverlay.style.borderRadius = '12px';
  mtOverlay.style.padding = '1rem';
  mtOverlay.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)';
  mtOverlay.style.zIndex = '1100';

  mtOverlay.innerHTML = `
    <h5 class="mb-3">Machining Times (h)</h5>
    <div class="alert alert-warning p-2 mb-3" role="alert" style="font-size: 0.9rem;">
      Machining Times are values provided by Engineering, and must represent the sum of Cutting and Printing times. 
      Modifying these values will directly impact KPI calculations.
    </div>
    ${PROGRAMS.map(program => `
      <div class="mb-3">
        <label class="form-label">${program}:</label>
        <input type="number" step="0.01" id="mt-edit-${program}" class="form-control" value="${machiningTimes[program] || ''}">
      </div>
    `).join('')}
    <div class="text-end">
      <button class="btn btn-sm btn-success me-2" onclick="saveMachiningTimes()">Save</button>
      <button class="btn btn-sm btn-outline-secondary" onclick="closeMTOverlay()">Close</button>
    </div>
  `;

  document.body.appendChild(mtOverlay);

  // Save updated machining times live
  PROGRAMS.forEach(program => {
    document.getElementById(`mt-edit-${program}`).addEventListener('input', (e) => {
      machiningTimes[program] = parseFloat(e.target.value) || 0;
    });
  });
}

// Close and remove the Machining Time overlay from the screen
function closeMTOverlay() {
  const mtOverlay = document.getElementById('mtOverlay');
  if (mtOverlay) mtOverlay.remove();
}

// Persist the edited Machining Time values to the backend via API
async function saveMachiningTimes() {
  try {
    const response = await fetch('/api/update-machining-times', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(machiningTimes)
    });

    if (response.ok) {
      alert('Machining times saved successfully!');
      closeMTOverlay();

      const previousExpandedKpi = currentKpi; // ✅ Save which KPI was open (ex: "Changeover Time (h)")
      const wasExpanded = isExpanded;

      await loadRealKpiData();      // Reload all fresh KPI data
      
      drawKpis();                   // Redraw cards
      updateHighlightGrid();        // Redraw highlights

      if (wasExpanded && previousExpandedKpi) {
        expandKPI(previousExpandedKpi); // ✅ Reopen expanded view
      }

    } else {
      alert('Failed to save machining times.');
    }
  } catch (err) {
    console.error('❌ Error saving MT:', err);
    alert('Failed to save machining times.');
  }
}

// Load the current Machining Time values from the backend into memory
async function loadMachiningTimes() {
  try {
    const response = await fetch('/api/get-machining-times');
    const data = await response.json();
    Object.assign(machiningTimes, data);
  } catch (err) {
    console.error('❌ Failed to load machining times:', err);
  }
}

// Fetch the number of quality defects for a given month to populate the Yield editor
function fetchDefectForMonth(month) {
  fetch('/api/quality-data')
    .then(res => res.json())
    .then(data => {
      const match = data.find(entry => entry.month === month);
      document.getElementById('defectInput').value = match ? match.defects : 0;
    })
    .catch(err => {
      console.error("Error loading defects for month:", err);
      document.getElementById('defectInput').value = 0;
    });
}

// Open the overlay interface to manually edit Yield data (defects per month)
function showYieldEditor() {
  const today = new Date();
  const defaultMonth = today.toISOString().slice(0, 7); // "YYYY-MM"

  const html = `
    <div id="yieldEditor" style="position:fixed;top:15%;left:50%;transform:translateX(-50%);background:#fff;padding:1.5rem;border-radius:10px;box-shadow:0 0 15px rgba(0,0,0,0.3);z-index:2000;width:340px;">
      <h5 class="mb-3 text-center">Edit Monthly Quality Defects</h5>

      <div class="mb-3">
        <label for="monthSelector" class="form-label">Select Month:</label>
        <input type="month" class="form-control" id="monthSelector" value="${defaultMonth}">
      </div>

      <div class="mb-3">
        <label for="defectInput" class="form-label">Defects:</label>
        <input type="number" class="form-control" id="defectInput" min="0" value="0">
      </div>

      <div class="text-end mt-3">
        <button class="btn btn-sm btn-success" onclick="saveYieldData()">Save</button>
        <button class="btn btn-sm btn-secondary ms-2" onclick="closeYieldEditor()">Cancel</button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);

  fetchDefectForMonth(defaultMonth); // preload current month

  document.getElementById("monthSelector").addEventListener("change", e => {
    fetchDefectForMonth(e.target.value);
  });
}

// Close and remove the Yield editor overlay
function closeYieldEditor() {
  const el = document.getElementById('yieldEditor');
  if (el) el.remove();
}

// Save updated Yield (defect) data to the backend and refresh the KPI
function saveYieldData() {
  const month = document.getElementById('monthSelector').value;
  const defects = parseInt(document.getElementById('defectInput').value) || 0;

  fetch('/api/quality-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ month, defects }])
  })
  .then(res => {
    if (res.ok) {
      closeYieldEditor();
      fetch('/api/kpi')
        .then(r => r.json())
        .then(({ kpis, shifts, machines }) => {
          dataByKpi['Yield (%)'] = kpis['Yield (%)'];
          kpiShiftOverlays['Yield (%)'] = shifts['Yield (%)'];
          kpiMachineOverlays['Yield (%)'] = machines['Yield (%)'];

          updateSingleKpiCard('Yield (%)');
          if (highlights.has('Yield (%)')) updateSingleHighlight('Yield (%)');
          expandKPI('Yield (%)');
        });

        

    } else {
      alert("Error saving.");
    }
  });
}

// Create and return a visual KPI card for the highlights section based on a KPI name
function createHighlightCard(kpiName) {
  const kpi = kpis.find(k => k.name === kpiName);
  if (!kpi || !dataByKpi[kpiName]) return null;

  const card = document.createElement("div");
  card.className = "kpi-card highlighted";

  const expandBtn = document.createElement("div");
  expandBtn.className = "expand-btn";
  expandBtn.innerHTML = '<i class="fas fa-expand-arrows-alt"></i>';
  expandBtn.onclick = () => expandKPI(kpiName);

  const starBtn = document.createElement("div");
  starBtn.className = "star-btn";
  starBtn.innerHTML = '<i class="fas fa-star"></i>';
  starBtn.style.color = 'gold';
  starBtn.onclick = () => {
    highlights.delete(kpiName);
    updateHighlightGrid();
    drawKpis();
    saveUserPreferences();
  };

  const infoBtn = document.createElement("div");
  infoBtn.className = "info-btn";
  infoBtn.innerHTML = '<i class="fas fa-info-circle"></i>';
  infoBtn.onclick = (event) => {
    event.stopPropagation();
    showInfoBubble(kpiName, infoBtn);
  };

  const header = document.createElement("div");
  header.className = "w-100 px-1 mb-1 d-flex flex-column";

  const title = document.createElement("div");
  title.className = "kpi-name text-start flex-grow-1";
  title.style.fontSize = "1.3rem";
  title.style.wordBreak = "break-word";
  title.textContent = kpiName.replace(/\s*\([^)]+\)/, '');
  if (['Cycle Time (h)', 'Changeover Time (h)'].includes(kpiName)) {
    title.style.marginTop = '1rem';
  }
  header.appendChild(title);

  card.appendChild(starBtn);
  card.appendChild(expandBtn);
  card.appendChild(infoBtn);
  card.appendChild(header);

  const canvas = document.createElement("canvas");
  canvas.id = `highlight-${kpiName}`.replace(/[^a-zA-Z0-9]/g, "");
  card.appendChild(canvas);

  const ctx = canvas.getContext("2d");

  const kpiData = dataByKpi[kpiName];
  const rawLabels = kpiData.labels || [];
  const rawValues = kpiData.values || [];

  const today = new Date();
  const past7Days = [];
  const displayLabels = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const label = formatShortWeekLabel(d);
    past7Days.push(label);
    displayLabels.push(label);
  }

  const labelMap = {};
  rawLabels.forEach((l, idx) => {
    const assumedLocal = new Date(`${l}T00:00:00`);
    const local = new Date(assumedLocal.toLocaleString("en-US", { timeZone: "America/Chicago" }));

    const weekday = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][local.getDay()];
    const formatted = `${weekday} ${local.getMonth() + 1}/${local.getDate()}`;
    labelMap[formatted] = rawValues[idx];
  });

  const values = displayLabels.map(l => labelMap[l] ?? null);

  const selectedShifts = kpiShiftSelections[kpiName] || [];
  const selectedMachines = kpiMachineSelections[kpiName] || [];

  const currentShiftData = shiftDataByKpi[kpiName] || {};
  const currentMachineData = machineDataByKpi[kpiName] || {};


  const shiftOverlay = {};
  selectedShifts.forEach(shift => {
    if (currentShiftData[shift]) {
      shiftOverlay[shift] = mapShiftToLabels(
        rawLabels,
        currentShiftData[shift],
        displayLabels,
        formatShortWeekLabel
      );
      
    }
  });

  const machineOverlay = {};
  selectedMachines.forEach(machine => {
    const rawMachineValues = currentMachineData[machine] || [];
    const machineLabelToValue = {};
    rawLabels.forEach((l, i) => {
      const assumedLocal = new Date(`${l}T00:00:00`);
      const local = new Date(assumedLocal.toLocaleString("en-US", { timeZone: "America/Chicago" }));

      const weekday = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][local.getDay()];
      const formatted = `${weekday} ${local.getMonth() + 1}/${local.getDate()}`;
      machineLabelToValue[formatted] = rawMachineValues[i];
    });
    machineOverlay[machine] = displayLabels.map(label => machineLabelToValue[label] ?? null);
  });

  renderChart(
    ctx,
    values,
    displayLabels,
    thresholds[kpiName],
    goals[kpiName] || 'maximize',
    '',
    selectedShifts,
    selectedMachines,
    shiftOverlay,
    machineOverlay
  );

  return card;
}

// Update the 3 small KPI summary boxes with average values and variation arrows
function updateSmallKpiBoxes() {
  const config = [
    { name: "OEE (%)", boxId: "box-oee", nowId: "oee-now", prevId: "oee-prev", arrowId: "arrow-oee" },
    { name: "Active Utilization (%)", boxId: "box-util", nowId: "util-now", prevId: "util-prev", arrowId: "arrow-util" },
    { name: "Production Achievement (%)", boxId: "box-prod", nowId: "prod-now", prevId: "prod-prev", arrowId: "arrow-prod" }
  ];

  const today = new Date();
  const labels = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - i - 1); // -1 = exclude today
    return getAustinDateStringFromISO(d.toISOString());
  }).reverse(); // oldest to newest

  config.forEach(cfg => {
    const data = dataByKpi[cfg.name];
    if (!data || !Array.isArray(data.labels)) return;

    const now = new Date();
    const todayAustin = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
    const todayStr = todayAustin.toISOString().slice(0, 10); // 'YYYY-MM-DD'
    
    const labelToValue = {};
    data.labels.forEach((d, i) => {
      const key = typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);
      if (key !== todayStr) {
        labelToValue[key] = data.values[i];
      }
    });
    
    

    const values = labels.map(l => labelToValue[l] ?? null);
    const pastNow = avg(values.slice(7, 14));
    const pastPrev = avg(values.slice(0, 7));

    const box = document.getElementById(cfg.boxId);
    const nowEl = document.getElementById(cfg.nowId);
    const prevEl = document.getElementById(cfg.prevId);
    const arrow = document.getElementById(cfg.arrowId);

    nowEl.textContent = pastNow != null ? pastNow.toFixed(1) + "%" : "--";
    prevEl.textContent = pastPrev != null ? pastPrev.toFixed(1) + "%" : "--";

    // Arrow
    if (pastNow != null && pastPrev != null) {
      const delta = pastNow - pastPrev;
      arrow.className = "fas " + (delta >= 0 ? "fa-arrow-up text-success" : "fa-arrow-down text-danger");
    }

    // Background
    const threshold = thresholds[cfg.name];
    box.classList.remove("positive", "negative");
    if (!isNaN(threshold)) {
      if (goals[cfg.name] === "maximize") {
        box.classList.add(pastNow >= threshold ? "positive" : "negative");
      } else {
        box.classList.add(pastNow <= threshold ? "positive" : "negative");
      }
    }

    if (cfg.name === "Production Achievement (%)") {
      const alertBox = document.getElementById("alertsContent");
      if (!alertBox) return;
    
      const labels = dataByKpi["Production Achievement (%)"]?.labels || [];
      const shiftData = shiftDataByKpi["Production Achievement (%)"];
      const values = data.values;
    
      const lastIndex = labels.length - 1;
      const lastValue = values[lastIndex];
    
      const lastDate = labels[labels.length - 1]; // exemple : "2025-04-30"
      let shift1 = null, shift2 = null, shift3 = null;
      
      if (shiftData && Array.isArray(shiftData.shift1)) {
        const shiftLabels = dataByKpi["Production Achievement (%)"].labels;
        const labelToIndex = Object.fromEntries(shiftLabels.map((d, i) => [d, i]));
        const shiftIndex = labelToIndex[lastDate];
      
        if (shiftIndex !== undefined) {
          shift1 = shiftData.shift1?.[shiftIndex] ?? null;
          shift2 = shiftData.shift2?.[shiftIndex] ?? null;
          shift3 = shiftData.shift3?.[shiftIndex] ?? null;
        }
      }
      
      if (lastValue != null && lastValue < 75) {
        alertBox.innerHTML = `
          ⚠️ Production Achievement on <strong>${new Date(lastDate).toISOString().slice(0, 10)}</strong> was <strong>${lastValue.toFixed(1)}%</strong>.<br>
          ➤ 1st Shift: <strong>${format(shift1)}</strong> | 
          2nd Shift: <strong>${format(shift2)}</strong> | 
          3rd Shift: <strong>${format(shift3)}</strong>
        `;
        alertBox.style.color = "#dc3545";
        alertBox.style.fontWeight = "600";
      } else {
        alertBox.innerHTML = "No active alerts.";
        alertBox.style.color = "#6c757d";
        alertBox.style.fontWeight = "normal";
      }
    }
    
    
    
  });

      
  function format(val) {
    return val != null ? `${val.toFixed(1)}%` : "--";
  }

  function avg(arr) {
    const valid = arr.filter(v => v != null && !isNaN(v));
    if (valid.length === 0) return null;
    return valid.reduce((a, b) => a + b, 0) / valid.length;
  }
}

// EXECUTIVE SUMMARY
function getLatest(kpiName) {
  const kpi = dataByKpi[kpiName];
  if (!kpi || !Array.isArray(kpi.labels) || !Array.isArray(kpi.values)) return null;

  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() - 1); // yesterday
  const start = new Date(today);
  start.setDate(start.getDate() - 30); // D-10

  let values;

if (kpiName === 'Production Achievement (%)' || kpiName === 'Active Utilization (%)') {
    // Special case: only one value per day (avoid duplicates)
    const seenDates = new Set();
    values = [];

    for (let i = 0; i < kpi.labels.length; i++) {
      const labelDate = new Date(kpi.labels[i]);
      const dateKey = labelDate.toISOString().split("T")[0];

      if (labelDate >= start && labelDate <= end && !seenDates.has(dateKey)) {
        if (kpi.values[i] != null) {
          seenDates.add(dateKey);
          values.push(kpi.values[i]);
        }
      }
    }


  } else {
    // Default case for other KPIs: use raw values in range
    values = kpi.labels
      .map((label, idx) => {
        const date = new Date(label);
        if (date >= start && date <= end) return kpi.values[idx];
        return null;
      })
      .filter(v => v != null);
  }

  if (values.length === 0) return null;
  if (kpiName === 'Active Utilization (%)') {
    console.log("[UTIL] Unique daily values (D-10 to D-1):", values);
  }
  

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Number(avg.toFixed(1));
}

// Return the average KPI value from the 30–60 day window before today
function getPrevious(kpiName) {
  const kpi = dataByKpi[kpiName];
  if (!kpi || !Array.isArray(kpi.labels) || !Array.isArray(kpi.values)) return null;

  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() - 31); // D-11
  const start = new Date(today);
  start.setDate(start.getDate() - 60); // D-20

  let values;

if (kpiName === 'Production Achievement (%)' || kpiName === 'Active Utilization (%)') {
    // Special case: one unique value per day
    const seenDates = new Set();
    values = [];

    for (let i = 0; i < kpi.labels.length; i++) {
      const labelDate = new Date(kpi.labels[i]);
      const dateKey = labelDate.toISOString().split("T")[0];

      if (labelDate >= start && labelDate <= end && !seenDates.has(dateKey)) {
        if (kpi.values[i] != null) {
          seenDates.add(dateKey);
          values.push(kpi.values[i]);
        }
      }
    }

  } else {
    // Default case for other KPIs
    values = kpi.labels
      .map((label, idx) => {
        const date = new Date(label);
        if (date >= start && date <= end) return kpi.values[idx];
        return null;
      })
      .filter(v => v != null);
  }

  if (values.length === 0) return null;
  if (kpiName === 'Efficiency (%)') {
    console.log("[EFF] Raw values (D-10 to D-1):", values);
  }
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Number(avg.toFixed(1));
}

// Return the average KPI value from the 30–60 day window before today
function generateExecutiveSummary() {
  const summaryLines = [];
  let utilEffLine = null;
  let shiftOee = null;
  let shiftProd = null;
  const machineDisparities = [];

  // Utilitaire local
  function addIfValid(descriptionFn) {
    const result = descriptionFn();
    if (result && !result.includes("n/a")) {
      summaryLines.push(result);
    }
  }

  // 🔹 Valeurs principales
  const oee       = getLatest('OEE (%)'),       oeePrev = getPrevious('OEE (%)');
  const avail     = getLatest('Availability (%)'), availPrev = getPrevious('Availability (%)');
  const util      = getLatest('Active Utilization (%)'), utilPrev = getPrevious('Active Utilization (%)');
  const eff       = getLatest('Efficiency (%)'), effPrev = getPrevious('Efficiency (%)');
  const prod      = getLatest('Production Achievement (%)'), prodPrev = getPrevious('Production Achievement (%)');
  const yieldVal  = getLatest('Yield (%)'), yieldPrev = getPrevious('Yield (%)');
  const corrective = getLatestMaintenance('Corrective Maintenance Rate (%)');
  const correctivePrev = getPreviousMaintenance('Corrective Maintenance Rate (%)');
  
  const maintEff = getLatestMaintenance('Maintenance Operation Efficiency (%)');
  const maintEffPrev = getPreviousMaintenance('Maintenance Operation Efficiency (%)');
  
  const downtime = getLatestMaintenance('Mean Downtime (h)');
  const downtimePrev = getPreviousMaintenance('Mean Downtime (h)');
  const mtbf = getLatestMaintenance('MTBF (h)');
  const mtbfPrev = getPreviousMaintenance('MTBF (h)');
  const labels = dataByKpi["OEE (%)"]?.labels || [];
  const shiftOeeRaw = shiftDataByKpi["OEE (%)"];
 
 if (shiftOeeRaw && labels.length) {
   const today = new Date();
   const logs = [];
 
   for (let i = 0; i < labels.length; i++) {
     const date = new Date(labels[i]);
     const daysAgo = (today - date) / (1000 * 60 * 60 * 24);
 
     if (daysAgo >= 1 && daysAgo <= 10) {
       logs.push({
         date: labels[i].slice(0, 10),
         shift1: shiftOeeRaw.shift1?.[i] ?? null,
         shift2: shiftOeeRaw.shift2?.[i] ?? null,
         shift3: shiftOeeRaw.shift3?.[i] ?? null,
       });
     }
   }
 
 }

 const shiftProdRaw = shiftDataByKpi["Production Achievement (%)"];
 const labelsProd = dataByKpi["Production Achievement (%)"]?.labels || [];
 
 if (shiftProdRaw && labelsProd.length) {
   const today = new Date();
   const perDay = {};
 
   for (let i = 0; i < labelsProd.length; i++) {
     const date = new Date(labelsProd[i]);
     const daysAgo = (today - date) / (1000 * 60 * 60 * 24);
     if (daysAgo < 1 || daysAgo > 10) continue;
 
     const key = labelsProd[i].slice(0, 10); // YYYY-MM-DD
 
     if (!perDay[key]) {
       perDay[key] = { shift1: [], shift2: [], shift3: [] };
     }
 
     if (shiftProdRaw.shift1?.[i] != null) perDay[key].shift1.push(shiftProdRaw.shift1[i]);
     if (shiftProdRaw.shift2?.[i] != null) perDay[key].shift2.push(shiftProdRaw.shift2[i]);
     if (shiftProdRaw.shift3?.[i] != null) perDay[key].shift3.push(shiftProdRaw.shift3[i]);
   }
 
   const logs = Object.entries(perDay).map(([date, shifts]) => ({
     date,
     shift1: shifts.shift1.length ? (shifts.shift1.reduce((a, b) => a + b, 0) / shifts.shift1.length).toFixed(1) : null,
     shift2: shifts.shift2.length ? (shifts.shift2.reduce((a, b) => a + b, 0) / shifts.shift2.length).toFixed(1) : null,
     shift3: shifts.shift3.length ? (shifts.shift3.reduce((a, b) => a + b, 0) / shifts.shift3.length).toFixed(1) : null,
   }));
 
 }
 

 


  // 🔹 Bloc Production & Performance
  addIfValid(() => `${describeDelta("OEE", oee, oeePrev)} ${getOeeComment(oee)}`);
  addIfValid(() => `${describeDelta("Availability", avail, availPrev)} ${getAvailabilityComment(avail)}`);
  
  utilEffLine = analyzeUtilizationAndEfficiency(util, eff, utilPrev, effPrev);
  if (utilEffLine && !utilEffLine.includes("n/a")) {
    summaryLines.push(utilEffLine);
  }

  addIfValid(() => `${describeDelta("Production Achievement", prod, prodPrev)} ${getProductionAchievementComment(prod)}`);
  addIfValid(() => `${describeDelta("Yield", yieldVal, yieldPrev)} ${getYieldComment(yieldVal)}`);

  // 🔹 Bloc Maintenance
  addIfValid(() => `${describeDelta("Corrective Maintenance Rate", corrective, correctivePrev)} ${getCorrectiveRateComment(corrective)}`);
  addIfValid(() => `${describeDelta("Maintenance Operation Efficiency", maintEff, maintEffPrev)} ${getMaintenanceEfficiencyComment(maintEff)}`);
  addIfValid(() => `${describeDelta("Mean Downtime", downtime, downtimePrev).replace("%", "h")} ${getMeanDowntimeComment(downtime)}`);
  addIfValid(() => `${describeDelta("MTBF", mtbf, mtbfPrev).replace("%", "h")} ${getMtbfComment(mtbf)}`);

  // 🔹 Disparités entre shifts
  const lastIndex = (dataByKpi["OEE (%)"]?.labels?.length || 1) - 1;
  const oeeByShift = [
    getLast30DayShiftAverage("OEE (%)", "shift1"),
    getLast30DayShiftAverage("OEE (%)", "shift2"),
    getLast30DayShiftAverage("OEE (%)", "shift3"),
  ];
  
  const prodByShift = [
    getLast30DayShiftAverage("Production Achievement (%)", "shift1"),
    getLast30DayShiftAverage("Production Achievement (%)", "shift2"),
    getLast30DayShiftAverage("Production Achievement (%)", "shift3"),
  ];
  

  shiftOee = describeShiftDetail("OEE (%)", oeeByShift);
  shiftProd = describeShiftDetail("Production Achievement (%)", prodByShift);

  // 🔹 Disparités machines (à remplacer plus tard par vraies fonctions)
  const unplannedDisp = listTopMachinesWithUnplannedDowntime(3);
  if (unplannedDisp) machineDisparities.push(unplannedDisp);


  return {
    summary: summaryLines,
    utilEffLine,
    shiftOee,
    shiftProd,
    machineDisparities
  };
}

// Return the 30-day average for a given shift within a specific KPI
function getLast30DayShiftAverage(kpiName, shiftKey) {
  const labels = dataByKpi[kpiName]?.labels || [];
  const shiftSeries = shiftDataByKpi[kpiName]?.[shiftKey];
  if (!labels.length || !Array.isArray(shiftSeries)) return null;

  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() - 1); // D–1
  const start = new Date(today);
  start.setDate(start.getDate() - 30); // D–30

  const values = [];

  for (let i = 0; i < labels.length; i++) {
    const date = new Date(labels[i]);
    if (date >= start && date <= end) {
      const val = shiftSeries[i];
      if (val != null) values.push(val);
    }
  }

  if (values.length === 0) return null;

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Number(avg.toFixed(1));
}

// Generate a textual description of change between current and previous values
function describeDelta(name, current, previous) {

  if (current == null || previous == null) return `The ${name} was ${current ?? "n/a"}.`;

  const fullName = name.includes("(") ? name : (
    name === "MTBF" ? "MTBF (h)" :
    name === "Mean Downtime" ? "Mean Downtime (h)" :
    name + " (%)"
  );
  

  const delta = Number(current) - Number(previous);
  const absDelta = Math.abs(delta);
  const trueName = `${name} (%)`;
  const color = getDeltaColor(fullName, delta);
  const deltaFormatted = `<span style="color:${color}">(${delta > 0 ? "+" : ""}${delta.toFixed(1)}%)</span>`;
  const valueFormatted = `<strong>${Number(current).toFixed(1)}%</strong>`;
  

  if (absDelta >= 7) {
    return `The ${name} changed significantly to ${valueFormatted} ${deltaFormatted}.`;
  } else if (absDelta >= 4) {
    return `The ${name} changed moderately to ${valueFormatted} ${deltaFormatted}.`;
  } else if (absDelta >= 1) {
    return `The ${name} changed slightly to ${valueFormatted} ${deltaFormatted}.`;
  } else {
    return `The ${name} remained stable at ${valueFormatted} ${deltaFormatted}.`;
  }
}

// Determine the color to use when displaying the delta value based on the KPI's goal
function getDeltaColor(kpiName, delta) {
  if (delta == null || isNaN(delta)) return '#6c757d'; // gris par défaut

  const maximizeList = [
    "OEE (%)", "Availability (%)", "Active Utilization (%)", "Efficiency (%)",
    "Production Achievement (%)", "Yield (%)", "MTBF (h)", "Maintenance Operation Efficiency (%)"
  ];

  const minimizeList = [
    "Planned Downtime (h)", "Unplanned Downtime (h)", "Corrective Maintenance Rate (%)",
    "Mean Downtime (h)", "Help Request Rate (calls/day)", "Help Request Response Time (min)",
    "Changeover Time (h)", "Cycle Time (h)"
  ];

  if (maximizeList.includes(kpiName)) {
    return delta > 0 ? '#28a745' : delta < 0 ? '#dc3545' : '#6c757d';
  }

  if (minimizeList.includes(kpiName)) {
    return delta < 0 ? '#28a745' : delta > 0 ? '#dc3545' : '#6c757d';
  }

  return '#6c757d'; // par défaut : gris
}

// Provide a qualitative comment based on the OEE (%) level
function getOeeComment(value) {
  if (value < 60) return "The OEE is critically low, reflecting cumulative losses in availability, efficiency, or quality. Immediate actions are needed.";
  if (value < 75) return "The OEE is in a moderate range. While performance is acceptable, improvements in runtime or reliability could help.";
  return "The OEE reached an excellent level, indicating high equipment effectiveness and operational stability.";
}

// Provide a qualitative comment based on the Availability (%) level
function getAvailabilityComment(value) {
  if (value < 65) return "Availability is critically low, indicating major machine downtime. This likely disrupted production and requires urgent investigation.";
  if (value < 75) return "Availability is low. Downtime is significantly impacting production and should be addressed.";
  if (value < 90) return "Availability is acceptable but shows room for improvement. Downtime reduction strategies could help.";
  return "Availability is excellent, reflecting minimal downtime and strong equipment readiness.";
}

// Provide a qualitative comment based on the Production Achievement (%) level
function getProductionAchievementComment(value) {
  if (value < 80) return "Production achievement is critical. Less than 80% of the target was met, indicating major underperformance.";
  if (value < 90) return "Production output is below target. Action may be required to prevent schedule delays.";
  if (value <= 100) return "Production output met expectations. Performance is on target.";
  return "Production exceeded expectations. The team outperformed the objective, demonstrating strong execution.";
}

// Provide a qualitative comment based on the Yield (%) level
function getYieldComment(value) {
  if (value < 90) return "The yield is critically low. A large share of production was defective. Quality systems must be reviewed.";
  if (value < 95) return "Yield is below standard. Non-conformities should be analyzed to reduce scrap and rework.";
  if (value < 98) return "Yield is acceptable, but quality improvements are still possible.";
  return "Yield is excellent, with minimal defects. This reflects strong process control.";
}

// Provide a qualitative comment based on the Corrective Maintenance Rate (%) level
function getCorrectiveRateComment(value) {
  if (value > 80) return "Corrective maintenance dominates downtime. This reactive pattern must be corrected through preventive strategies.";
  if (value > 60) return "Corrective maintenance is too high. Preventive planning needs to be reinforced.";
  return "Corrective maintenance is under control. The balance favors preventive interventions.";
}

// Provide a qualitative comment based on the Maintenance Operation Efficiency (%) level
function getMaintenanceEfficiencyComment(value) {
  if (value < 70) return "Maintenance efficiency is poor. Operations often exceed the planned time and need better execution control.";
  if (value < 85) return "Maintenance is often late. Improved planning and coordination are needed.";
  if (value < 95) return "Maintenance operations are mostly on time. Margins for improvement remain.";
  return "Maintenance efficiency is excellent. Most operations are completed within the expected timeframe.";
}

// Provide a qualitative comment based on the Mean Downtime (h) level
function getMeanDowntimeComment(value) {
  if (value > 24) return "Mean downtime is critical. Repairs are excessively long and severely impact availability.";
  if (value > 12) return "Mean downtime is high. This suggests problems with parts, tools, or diagnosis.";
  if (value > 8) return "Downtime duration is elevated. Optimization could reduce its impact.";
  if (value > 4) return "Mean downtime is acceptable. Repairs are generally under control.";
  return "Mean downtime is excellent. Repairs are short and minimally disruptive.";
}

// Provide a qualitative comment based on the MTBF (Mean Time Between Failures) level
function getMtbfComment(value) {
  if (value < 12) return "MTBF is critical. Failures occur almost every shift, showing poor reliability.";
  if (value < 24) return "MTBF is low. Failures happen daily, affecting performance.";
  if (value < 48) return "MTBF is moderate. Failures are spaced out but still too frequent.";
  if (value < 72) return "MTBF is good. Machines are generally reliable.";
  return "MTBF is excellent. Failures are rare and reliability is high.";
}

// Generate a summary sentence comparing shift-level performance for a specific KPI
function describeShiftDetail(kpiName, shiftValues) {
  const shifts = ['1st Shift', '2nd Shift', '3rd Shift'];
  const validShifts = shiftValues
    .map((v, i) => ({ shift: shifts[i], value: v }))
    .filter(x => x.value != null);

  if (validShifts.length < 3) return null;

  // Tri par valeur pour trouver min / max / middle
  validShifts.sort((a, b) => b.value - a.value);
  const max = validShifts[0];
  const mid = validShifts[1];
  const min = validShifts[2];
  const delta = max.value - min.value;

  const format = v => `<strong>${v.toFixed(1)}%</strong>`;

  if (kpiName === "OEE (%)") {
    if (delta < 4) {
      return `OEE values were consistent across shifts: ${shifts[0]}: ${format(shiftValues[0])}, ${shifts[1]}: ${format(shiftValues[1])}, ${shifts[2]}: ${format(shiftValues[2])}.`;
    } else if (delta < 8) {
      return `OEE varied moderately: highest was ${max.shift} at ${format(max.value)}, followed by ${mid.shift} (${format(mid.value)}) and ${min.shift} (${format(min.value)}).`;
    } else {
      return `OEE disparity is significant across shifts — ${max.shift} reached ${format(max.value)}, but ${min.shift} dropped to ${format(min.value)}. ${mid.shift} was in between at ${format(mid.value)}.`;
    }
  }

  if (kpiName === "Production Achievement (%)") {
    if (delta < 4) {
      return `Production Achievement remained stable across shifts: ${shifts[0]}: ${format(shiftValues[0])}, ${shifts[1]}: ${format(shiftValues[1])}, ${shifts[2]}: ${format(shiftValues[2])}.`;
    } else if (delta < 8) {
      return `There was a moderate shift in Production Achievement, from ${max.shift} at ${format(max.value)} to ${min.shift} at ${format(min.value)}. ${mid.shift} recorded ${format(mid.value)}.`;
    } else {
      return `A large gap in Production Achievement was observed: ${max.shift} peaked at ${format(max.value)}, while ${min.shift} fell to ${format(min.value)}. ${mid.shift} was at ${format(mid.value)}.`;
    }
  }

  return null;
}

// Identify the top machines with the most unplanned downtime over the last 30 days
function listTopMachinesWithUnplannedDowntime(n = 3) {
  const kpiName = "Unplanned Downtime (h)";
  const machineData = machineDataByKpi[kpiName] || {};
  const labels = dataByKpi[kpiName]?.labels || [];

  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const totals = Object.entries(machineData).map(([pc, values]) => {
    let sum = 0;
    for (let i = 0; i < labels.length; i++) {
      const date = new Date(labels[i]);
      if (date >= cutoff && values[i] != null) {
        sum += values[i];
      }
    }
    return { pc, value: sum };
  });

  const top = totals
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, n);

  if (top.length === 0) return null;

  const formatted = top
    .map(e => `<strong>${e.pc}</strong>: <strong>${e.value.toFixed(1)}h</strong>`)
    .join(", ");
  return `Highest unplanned downtime: ${formatted}.`;
}

// Generate a combined narrative based on Efficiency and Active Utilization trends and categories
function analyzeUtilizationAndEfficiency(util, eff, utilPrev, effPrev) {
  const deltaUtil = util != null && utilPrev != null ? (util - utilPrev).toFixed(1) : null;
  const deltaEff = eff != null && effPrev != null ? (eff - effPrev).toFixed(1) : null;

  const utilCat =
    util < 55 ? "critical" :
    util < 65 ? "very_low" :
    util < 75 ? "acceptable" : "excellent";

  const effCat =
    eff < 70 ? "low" :
    eff < 85 ? "medium" : "excellent";

  let sentence = "";

  if (utilCat === "critical" && effCat === "low") {
    sentence = `Both Active Utilization (${util.toFixed(1)}%) and Efficiency (${eff.toFixed(1)}%) are critically low, showing major losses in both time allocation and productivity.`;
  } else if (utilCat === "critical" && effCat === "excellent") {
    sentence = `Efficiency is excellent (${eff.toFixed(1)}%), but Active Utilization is critically low (${util.toFixed(1)}%), meaning too little of the planned time was spent machining.`;
  } else if (utilCat === "very_low" && effCat === "low") {
    sentence = `Low active utilization (${util.toFixed(1)}%) and poor efficiency (${eff.toFixed(1)}%) suggest issues both in schedule use and operational execution.`;
  } else if (utilCat === "very_low" && effCat === "medium") {
    sentence = `While efficiency is average (${eff.toFixed(1)}%), the low active utilization (${util.toFixed(1)}%) limits impact — too little of the schedule is used for machining.`;
  } else if (utilCat === "acceptable" && effCat === "low") {
    sentence = `Active utilization is fair (${util.toFixed(1)}%), but efficiency during runtime is low (${eff.toFixed(1)}%), pointing to execution inefficiencies.`;
  } else if (utilCat === "acceptable" && effCat === "excellent") {
    sentence = `Good usage of planned time - Active Utilization (${util.toFixed(1)}%) - combined with excellent efficiency (${eff.toFixed(1)}%) leads to solid overall performance.`;
  } else if (utilCat === "excellent" && effCat === "medium") {
    sentence = `Planned time is well used - Active Utilization (${util.toFixed(1)}%) - and runtime efficiency is decent (${eff.toFixed(1)}%). A few improvements could elevate the output further.`;
  } else if (utilCat === "excellent" && effCat === "excellent") {
    sentence = `Both Active Utilization (${util.toFixed(1)}%) and Efficiency (${eff.toFixed(1)}%) are excellent. Time was fully used and highly productive.`;
  } else {
    sentence = `Active Utilization (${util.toFixed(1)}%) and Efficiency (${eff.toFixed(1)}%) are within acceptable ranges.`;
  }

  // Ajoute les deltas à la fin de manière propre
  if (deltaUtil != null && deltaEff != null) {
    const utilColor = getDeltaColor("Active Utilization (%)", parseFloat(deltaUtil));
    const effColor = getDeltaColor("Efficiency (%)", parseFloat(deltaEff));
  
    const deltaUtilStr = `<span style="color:${utilColor}">${deltaUtil > 0 ? "+" : ""}${deltaUtil}%</span>`;
    const deltaEffStr  = `<span style="color:${effColor}">${deltaEff > 0 ? "+" : ""}${deltaEff}%</span>`;
    
  
    sentence += ` (${deltaUtilStr} / ${deltaEffStr})`;
  }
  

  return sentence;
}

// Fetch and render the list of previously generated monthly reports in the overlay
function loadReportList() {
  const list = document.getElementById('monthlyReportList');
  if (!list) return;

  list.innerHTML = "<li class='text-muted'>Loading...</li>";

  fetch('/api/reports')
    .then(res => res.json())
    .then(files => {
      list.innerHTML = "";

      if (!files || files.length === 0) {
        list.innerHTML = "<li class='text-muted'>No reports available</li>";
        return;
      }

      files.sort().reverse(); // most recent first

      files.forEach(filename => {
        const display = filename.replace("KitCut_Summary_", "").replace(".pdf", "");
        const li = document.createElement("li");
        li.innerHTML = `<a href="/reports/${filename}" target="_blank" style="text-decoration:none;color:#007bff;font-weight:500;display:block;margin-bottom:6px;">
          📎 ${display}
        </a>`;
        list.appendChild(li);
      });
    })
    .catch(err => {
      console.error("Error loading reports:", err);
      list.innerHTML = "<li class='text-danger'>Failed to load reports.</li>";
    });
}

// Calculate the 4-week average for a maintenance KPI using the most recent data
function getLatestMaintenance(kpiName) {
  const kpi = dataByKpi[kpiName];
  const labels = kpi?.labels || [];
  const values = kpi?.values || [];

  const now = new Date();
  const currentWeek = getWeekNumber(now);
  const currentYear = now.getFullYear();

  const recentWeeks = Array.from({ length: 4 }, (_, i) => `FW${currentWeek - 4 + i}-${currentYear}`);

  const selected = recentWeeks
    .map(week => {
      const idx = labels.indexOf(week);
      return idx !== -1 ? values[idx] : null;
    })
    .filter(v => v != null);

  if (selected.length === 0) return null;

  const avg = selected.reduce((a, b) => a + b, 0) / selected.length;
  return Number(avg.toFixed(1));
}

// Calculate the 4-week average for a maintenance KPI using the previous month of data
function getPreviousMaintenance(kpiName) {
  const kpi = dataByKpi[kpiName];
  const labels = kpi?.labels || [];
  const values = kpi?.values || [];

  const now = new Date();
  const currentWeek = getWeekNumber(now);
  const currentYear = now.getFullYear();

  const prevWeeks = Array.from({ length: 4 }, (_, i) => `FW${currentWeek - 8 + i}-${currentYear}`);

  const selected = prevWeeks
    .map(week => {
      const idx = labels.indexOf(week);
      return idx !== -1 ? values[idx] : null;
    })
    .filter(v => v != null);

  if (selected.length === 0) return null;

  const avg = selected.reduce((a, b) => a + b, 0) / selected.length;
  return Number(avg.toFixed(1));
}

// Return the ISO week number for a given date (used for maintenance KPI indexing)
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// Build and save the executive summary as a PDF using backend rendering from HTML
async function saveExecutiveSummaryPdf() {
  // Destructure executive summary content
  const {
    summary,
    utilEffLine,
    shiftOee,
    shiftProd,
    machineDisparities
  } = generateExecutiveSummary();

  // Compute the reporting range: D–30 to D–1
  const today = new Date();
  const end = new Date(today);
  end.setDate(today.getDate() - 1);
  const start = new Date(today);
  start.setDate(today.getDate() - 30);

  // Format date range
  const formatDate = (date) =>
    date.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const monthLabel = `${formatDate(start)} to ${formatDate(end)}`;
  const formattedDate = today.toISOString().split('T')[0]; // YYYY-MM-DD format
  const filename = `KitCut_Summary_${formattedDate}.pdf`;

  // Utility to fetch and encode image as base64
  const encodeImageToBase64 = async (url, mimeType) => {
    const response = await fetch(url);
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    return `data:${mimeType};base64,${base64}`;
  };

  // Encode both logos from the public/images folder
  const paretopsLogo = await encodeImageToBase64('/images/paretops.svg', 'image/svg+xml');
  const cfanLogo = await encodeImageToBase64('/images/cfan.png', 'image/png');

  // Build the full HTML for the PDF
  const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <style>
      body {
        font-family: Arial, sans-serif;
        padding: 35px 40px;
        color: #111;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 25px;
      }
      .header img {
        height: 70px;
      }
      .title {
        font-size: 24px;
        font-weight: bold;
        margin-bottom: 4px;
      }
      .subtitle {
        font-size: 14px;
        color: #555;
        margin-bottom: 30px;
      }
      .notice {
        font-style: italic;
        font-size: 13px;
        margin-bottom: 30px;
        color: #444;
      }
      h2 {
        font-size: 18px;
        margin-top: 40px;
        border-top: 1px solid #ccc;
        padding-top: 12px;
        color: #222;
      }
      ul {
        padding-left: 18px;
        font-size: 13px;
      }
      li {
        margin-bottom: 10px;
        line-height: 1.4;
      }
      li.disparity-title {
        list-style-type: none;
        font-style: italic;
        font-size: 13px;
        margin-top: 10px;
        margin-bottom: 5px;
      }
      .confidential {
        font-size: 10px;
        color: #777;
        text-align: center;
        margin-top: 60px;
      }
      .page-break {
        page-break-before: always;
      }
    </style>
  </head>
  <body>
    <!-- HEADER SECTION WITH LOGOS -->
    <div class="header">
      <img src="${paretopsLogo}" alt="ParetOPS logo">
      <img src="${cfanLogo}" alt="CFAN logo">
    </div>

    <!-- MAIN TITLE AND CONTEXT -->
    <div class="title">EXECUTIVE SUMMARY</div>
    <div class="subtitle">Kit Cut – ${monthLabel}</div>
    <div class="notice">
      This report was auto-generated by the <strong>ParetOPS (©)</strong> algorithm. It should be interpreted alongside the full KPI dashboard available on 
      <a href="http://localhost:3000/kpi_dashboard.html" style="text-decoration: none; color: #007bff;"><strong>ParetOPS: portail CFAN</strong></a>.
    </div>

    <!-- PRODUCTION KPIs SECTION -->
    <h2>Production & Performance</h2>
    <ul>
      ${summary.filter(line =>
        line.includes('OEE') ||
        line.includes('Availability') ||
        line === utilEffLine ||
        line.includes('Production Achievement') ||
        line.includes('Yield')
      ).map(line => `<li>${line}</li>`).join('')}
      ${shiftOee || shiftProd ? `<li class="disparity-title">Disparities between shift</li>` : ''}
      ${shiftOee ? `<li>${shiftOee}</li>` : ''}
      ${shiftProd ? `<li>${shiftProd}</li>` : ''}
    </ul>

    <!-- MAINTENANCE KPIs SECTION -->
    <h2>Maintenance</h2>
    <ul>
      ${summary.filter(line =>
        !(line.includes('OEE') ||
          line.includes('Availability') ||
          line === utilEffLine ||
          line.includes('Production Achievement') ||
          line.includes('Yield'))
      ).map(line => `<li>${line}</li>`).join('')}
      ${machineDisparities.length > 0 ? `<li class="disparity-title">Machines Requiring Attention</li>` : ''}
      ${machineDisparities.map(line => `<li>${line}</li>`).join('')}
    </ul>

    <!-- CONFIDENTIALITY NOTICE -->
    <div class="confidential">
      This report contains confidential information. All data and analyses included are the exclusive property of CFAN and may not be shared or reproduced without prior authorization.
    </div>
  </body>
  </html>`;

  // Send HTML to the backend for PDF generation
  // Send HTML to the backend for PDF generation (await)
  // Send HTML to the backend for PDF generation (await)
  const res = await fetch('/api/save-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, filename })
  });

  if (!res.ok) {
    throw new Error('Failed to save PDF');
  }

  // IMPORTANT: do not open here — let the caller handle UX
  return filename;


  }


// Initialize the Production KPI dashboard: load data, preferences, times, charts, and summaries
function startProductionKpiApp() {
  const start = performance.now();

  console.time("loadRealKpiData");
  loadRealKpiData()
    .then(() => {
      console.timeEnd("loadRealKpiData");

      console.time("loadUserPreferences");
      return loadUserPreferences();
    })
    .then(() => {
      console.timeEnd("loadUserPreferences");

      console.time("loadMachiningTimes");
      return loadMachiningTimes();
    })
    .then(() => {
      console.timeEnd("loadMachiningTimes");

      console.time("drawKpis");
      drawKpis();
      console.timeEnd("drawKpis");

      console.time("updateHighlightGrid");
      updateHighlightGrid();
      console.timeEnd("updateHighlightGrid");

      console.time("updateSmallKpiBoxes");
      updateSmallKpiBoxes();
      console.timeEnd("updateSmallKpiBoxes");

      const end = performance.now();
      console.log(`⏱️ TOTAL LOAD TIME: ${(end - start) / 1000}s`);

      if (typeof window.productionLoadingComplete === 'function') {
        window.productionLoadingComplete();
      }
    })
    .catch(err => console.error("❌ Production KPI Initialization failed:", err));

 
}

// Display the monthly report overlay with buttons for generating or loading executive summaries
function openMonthlyReportOverlay() {
  if (document.getElementById("monthlyReportOverlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "monthlyReportOverlay";
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100vw";
  overlay.style.height = "100vh";
  overlay.style.backgroundColor = "rgba(0, 0, 0, 0.6)";
  overlay.style.zIndex = "9999";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";

  overlay.innerHTML = `
    <div style="
      background: #ffffff;
      padding: 2rem;
      border-radius: 16px;
      width: 420px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
      text-align: center;
      font-family: 'Segoe UI', sans-serif;
    ">
      <h4 class="mb-4" style="font-weight: bold; color: #333;">📄 Monthly Report</h4>

      <button id="generateReportBtn" class="btn btn-primary w-100 mb-3" style="font-weight: 600;" onclick="handleReportGeneration()">
        <i class="fas fa-file-alt me-2"></i>
        <span id="generateText">Generate New Monthly Report</span>
      </button>

      <!-- Barre de progression cachée par défaut -->
      <div id="genProgress" class="progress w-100 mb-3" style="height:8px; display:none;">
        <div id="genProgressBar" class="progress-bar progress-bar-striped progress-bar-animated" style="width:0%"></div>
      </div>


      <button class="btn btn-outline-secondary w-100 mb-3" style="font-weight: 600;" onclick="loadReportList()">
        <i class="fas fa-folder-open me-2"></i>Load Past Reports
      </button>

      <div id="monthlyReportListContainer" style="max-height: 200px; overflow-y: auto; margin-top: 1rem;">
        <ul id="monthlyReportList" class="list-unstyled text-start" style="padding: 0 1rem;"></ul>
      </div>

      <button class="btn btn-sm btn-danger mt-4" onclick="document.getElementById('monthlyReportOverlay').remove()">
        Close
      </button>
    </div>
  `;


  document.body.appendChild(overlay);
}

window.handleReportGeneration = async function () {
  const btn = document.getElementById('generateReportBtn');
  const txt = document.getElementById('generateText');
  const barWrap = document.getElementById('genProgress');
  const bar = document.getElementById('genProgressBar');

  // UI on
  btn.disabled = true;
  txt.textContent = 'Generating...';
  barWrap.style.display = 'block';
  bar.style.width = '0%';

  // 👇 Force le repaint pour voir la barre dès maintenant
  await new Promise(r => requestAnimationFrame(r));

  // Progression douce ~8s jusqu’à 90%
  const MIN_MS = 8000;
  const start = performance.now();
  let progress = 0;
  const tickMs = 100;
  const step = 90 / (MIN_MS / tickMs);
  const timer = setInterval(() => {
    progress = Math.min(90, progress + step);
    bar.style.width = `${progress.toFixed(1)}%`;
  }, tickMs);

  try {
    const filename = await saveExecutiveSummaryPdf();  // attend VRAIMENT la fin

    // Respecte la durée mini de 8s si le backend a été plus rapide
    const elapsed = performance.now() - start;
    if (elapsed < MIN_MS) {
      await new Promise(r => setTimeout(r, MIN_MS - elapsed));
    }

    clearInterval(timer);
    bar.style.width = '100%';
    txt.textContent = 'Opening report...';

    // Ouvre le PDF + rafraîchit la liste
    window.open(`/reports/${filename}`, '_blank');
    if (typeof loadReportList === 'function') await loadReportList();

    setTimeout(() => {
      txt.textContent = 'Generate New Monthly Report';
      barWrap.style.display = 'none';
      bar.style.width = '0%';
      btn.disabled = false;
    }, 500);
  } catch (err) {
    clearInterval(timer);
    console.error('Report generation failed:', err);
    txt.textContent = 'Error. Try again';
    barWrap.style.display = 'none';
    btn.disabled = false;
    alert('Failed to create PDF. Please try again.');
  }
};






// Attach DOMContentLoaded event listener to initialize report button (e.g. load report list when dropdown is clicked)
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('dropdownReportsBtn');
  if (btn) btn.addEventListener('click', loadReportList);
});

  // Expose the entry point globally
  window.startProductionKpiApp = startProductionKpiApp;
  window.expandedChart = null;
  window.currentKpi = null;
  window.isExpanded = false;
  window.currentTimeFilter = "week";

  window.setCurrentWeek = setCurrentWeek;
  window.setCurrentMonth = setCurrentMonth;
  window.setYTD = setYTD;
  window.setTimeframe = setTimeframe;
  window.updateCharts = updateCharts;
  window.expandKPI = expandKPI;
  window.closeOverlay = closeOverlay;
  window.handleShiftExclusivity = handleShiftExclusivity;
  window.handleMachineShiftExclusivity = handleMachineShiftExclusivity;
  window.getSelectedMachines = getSelectedMachines;
  window.showMTOverlay = showMTOverlay;
  window.closeMTOverlay = closeMTOverlay;
  window.saveMachiningTimes = saveMachiningTimes;
  window.closeOverlay = closeOverlay;
  window.showYieldEditor = showYieldEditor;
  window.closeYieldEditor = closeYieldEditor;
  window.saveYieldData = saveYieldData;
  window.machiningTimes = machiningTimes;
  window.saveExecutiveSummaryPdf = saveExecutiveSummaryPdf;
  window.loadReportList = loadReportList;
  window.openMonthlyReportOverlay = openMonthlyReportOverlay;
})();