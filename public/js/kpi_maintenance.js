/**
 * kpi_maintenance.js - CONFIDENTIAL - PROPERTY OF PARETOPS
 *
 * For maintenance-related dashboard support, contact: support@paretops.com
 *
 * DESCRIPTION:
 * This script powers the Maintenance KPI dashboard in the ParetOPS platform.
 * It collects data from backend APIs, renders dynamic compact KPI cards,
 * machine-level statuses, contributor charts, alerts, benchmarks, and expanded visualizations.
 *
 * PURPOSE:
 * - Display and monitor real-time and historical maintenance performance indicators.
 * - Visualize top downtime contributors and track weekly machine benchmarks.
 * - Provide immediate insight into problem areas (e.g. frequent failures, long downtime).
 * - Allow threshold configuration and goal direction (maximize/minimize) per KPI.
 *
 * FEATURES:
 * - Compact KPI cards with color-coded bar charts and deltas.
 * - Fullscreen expandable KPI view with filters and comparison overlays.
 * - Live machine status display with auto-refresh and downtime context.
 * - Pareto analysis and summary alerts based on last 30 days.
 * - Weekly benchmarking of machines using MTBF, MDT, and total DT.
 * - Threshold goal setting persisted to backend.
 * - Overlay and redirection system to maintenance logs and detail pages.
 *
 * DEPLOYMENT:
 * - Linked to `maintenance_kpi.html`
 * - Backend endpoints required:
 *   • `/api/maintenance/kpi`
 *   • `/api/maintenance/summary`
 *   • `/api/maintenance/benchmark`
 *   • `/api/logs/:plyCutter`
 *   • `/api/save-threshold`
 *   • `/get_logs`
 *   • `/api/get-all-status`
 *   • `/api/get-threshold`
 *
 * DEPENDENCIES:
 * - Chart.js with annotation plugin
 * - Bootstrap (for DOM structure and responsiveness)
 * - Font Awesome (icons)
 * - Utility functions (from `utils.js`)
 *
 * AUTHOR:
 * Paulin Colin BANCKAERT — Maintenance KPI Module v3.0.0
 *
 * VERSIONING:
 * - Version-controlled via Git
 * - Any changes impacting visuals, charting logic, or API contracts must be tagged
 */


(() => {

const CONFIG = window.appConfig || {};
const MACHINES = CONFIG.machines ;
const PROGRAMS = CONFIG.productionSetup
  ? Object.keys(CONFIG.productionSetup.parts || {})
  : [];

let dataByKpi_maintenance = {};
let expandedTimeframeDays = 90; // default to 3 months
const machineFiltersByKpi = {};


// Create a compact KPI card element with color-coded bars and optional threshold line
async function createKpiCard(name, kpiData) {
  const card = document.createElement("div");
  card.className = "kpi-card";

  // Create the KPI title
  const title = document.createElement("div");
  title.className = "kpi-name";
  title.textContent = name;

  // Create the expand icon to open the KPI in expanded view
  const expandBtn = document.createElement("div");
  expandBtn.className = "expand-btn";
  expandBtn.innerHTML = '<i class="fas fa-expand-arrows-alt"></i>';
  expandBtn.onclick = () => expandDowntimeKPI(name);

  // Create canvas for the chart
  const canvas = document.createElement("canvas");
  canvas.height = 280;

  // Add elements to the card
  card.appendChild(title);
  card.appendChild(expandBtn);
  card.appendChild(canvas);

  // Extract the last 6 values from the data
  const today = new Date();
  const labels = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today.getTime() - i * 86400000);
    labels.push(date.toISOString().slice(0, 10)); // Format yyyy-mm-dd
  }

  const valueMap = {};
  kpiData.labels.forEach((label, i) => valueMap[label] = kpiData.values[i]);

  const values = labels.map(label => valueMap[label] ?? null);

  const ctx = canvas.getContext("2d");

  // Determine the color of each bar based on threshold and goal
  const barColors = values.map(v => {
    if (v === null || isNaN(threshold)) return '#cccccc'; // gray if no data
    const isRed = (goal === 'maximize' && v < threshold) || (goal === 'minimize' && v > threshold);
    return isRed ? '#dc3545' : '#28a745'; // red = bad, green = good
  });

  // Create the bar chart with optional threshold line
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: barColors
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        annotation: {
          annotations: !isNaN(threshold) ? {
            thresholdLine: {
              type: 'line',
              yMin: threshold,
              yMax: threshold,
              borderColor: 'red',
              borderWidth: 2,
              label: {
                display: true,
                content: `Threshold: ${threshold}`,
                position: 'end',
                backgroundColor: 'rgba(255,255,255,0.8)',
                color: 'red',
                font: { weight: 'bold' }
              }
            }
          } : {}
        }
      },
      scales: {
        y: {
          beginAtZero: true
        }
      }
    },
    plugins: [Chart.registry.getPlugin('annotation')]
  });

  return card;
}

// Return a color value based on a benchmark score (used in speedometer/needle visuals)
function getColorFromScore(score) {
  if (score < 20) return '#c82333';       // rouge foncé
  if (score < 40) return '#dc3545';       // rouge standard
  if (score < 60) return '#fd7e14';       // orange
  if (score < 80) return '#28a745';       // vert standard
  return '#218838';                       // vert foncé
}
  
// Load all machine statuses (UP/DOWN) from backend and render status tiles
async function loadMachineStatuses() {
  try {
    const res = await fetch('/api/get-all-status');
    const machines = await res.json();
    const container = document.getElementById('machineStatusList');

    const allPlyCutters = ['PC1', 'PC2', 'PC4', 'PC5', 'PC6', 'PC7', 'PC8', 'PC9'];

    container.innerHTML = '';

    for (const pc of allPlyCutters) {
      const machine = machines.find(m => m.plyCutter === pc);
      const isUp = machine?.status?.toUpperCase() === 'UP';
    
          
      const div = document.createElement('div');
      div.className = 'machine-tile ' + (isUp ? 'machine-up' : 'machine-down');
      div.onclick = () => showRedirectPrompt(pc);

      // Ligne du haut : nom + statut à droite
      const header = document.createElement('div');
      header.className = 'd-flex w-100 align-items-center gap-2';
      

      // Nom du ply cutter
      const name = document.createElement('div');
      name.className = 'machine-label';
      name.textContent = pc;

      // Texte à droite (UP / DOWN – Xh)
      const statusBlock = document.createElement('div');
      statusBlock.className = 'machine-status-block';
      
      // Si machine est UP → simplement afficher UP
      if (isUp) {
        const upText = document.createElement('div');
        upText.textContent = 'UP';
        upText.className = 'machine-status-line-up';
        statusBlock.appendChild(upText);
      } else {
        let log = null;
      
        try {
          const logRes = await fetch(`/get_logs?plyCutter=${pc}`);
          const logData = await logRes.json();
          log = logData?.activeLog;
        } catch (err) {
          console.warn(`Failed to load log for ${pc}`, err);
        }
      
        const effectiveStart = log?.start_time ? new Date(log.start_time) : new Date(machine.updated_at);
        const diffMs = Date.now() - effectiveStart;
        const diffMin = Math.floor(diffMs / 1000 / 60);
        const downLine = document.createElement('div');
        downLine.className = 'machine-status-line-down';
        downLine.textContent = diffMin < 60
          ? `DOWN – ${diffMin}min`
          : `DOWN – ${Math.floor(diffMin / 60)}h`;
        statusBlock.appendChild(downLine);
      
        if (log) {
          const lines = [];
          if (log.reason) lines.push(`📌 ${log.reason}`);
          if (log.comment) lines.push(`📝 ${log.comment}`);
          if (log.work_order) lines.push(`🔧 WO: ${log.work_order}`);
      
          lines.forEach(line => {
            const lineEl = document.createElement('div');
            lineEl.textContent = line;
            statusBlock.appendChild(lineEl);
          });
        }
      }
      
      

      // Structure finale
      header.appendChild(name);
      header.appendChild(statusBlock);

      div.appendChild(header);
      container.appendChild(div);

      
    }
    

  } catch (err) {
    console.error('❌ Failed to load machine status:', err);
  }
}

// Fetch top contributors to downtime and render a horizontal bar chart in the KPI panel
let downtimeChart = null;
async function loadDowntimeContributors(range = '1m') {
  try {
    // Update button active style
    document.querySelectorAll('.btn-group-sm button').forEach(btn => {
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-outline-primary');
    });

    const activeBtn = document.querySelector(`.btn-group-sm button[onclick*="'${range}'"]`);
    if (activeBtn) {
      activeBtn.classList.remove('btn-outline-primary');
      activeBtn.classList.add('btn-primary');
    }

    const res = await fetch(`/api/maintenance/kpi?range=${range}`);
    const data = await res.json();

    const contributors = data.contributors || [];

    const labels = contributors.map(d => d.reason || 'Unknown');
    const values = contributors.map(d => parseFloat(d.total_hours).toFixed(1));

    const ctx = document.getElementById('downtimeChart').getContext('2d');
    if (downtimeChart) downtimeChart.destroy();

    downtimeChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Total Downtime (h)',
          data: values,
          backgroundColor: '#dc3545'
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.parsed.y} hours`
            }
          }
        },
        scales: {
          x: {
            ticks: {
              autoSkip: false,
              maxRotation: 90,
              minRotation: 0
            }
          },
          y: {
            beginAtZero: true
          }
        }
      }
    });

  } catch (err) {
    console.error('❌ Failed to load downtime contributors:', err);
  }
}

// Render all maintenance KPI cards in compact form, using color logic and thresholds
async function drawMaintenanceKpis() {
  const container = document.getElementById("kpiContainer");
  container.innerHTML = "";

  // Loop through each KPI
  for (const kpiName of Object.keys(dataByKpi_maintenance)) {
    const kpiData = dataByKpi_maintenance[kpiName];

    // Fetch threshold and goal (maximize/minimize) from the database
    let threshold = null;
    let goal = 'maximize';
    try {
      const res = await fetch(`/api/get-threshold?kpi=${encodeURIComponent(kpiName)}`);
      const prefs = await res.json();
      threshold = parseFloat(prefs.threshold);
      goal = prefs.goal;
    } catch (err) {
      console.warn(`No threshold data for KPI ${kpiName}`);
    }

    // Skip if no valid data
    if (!kpiData || !Array.isArray(kpiData.values) || kpiData.values.length === 0) continue;

  // Generate the last 6 week labels with year: FWxx-YYYY
  const today = new Date();
  const last6Weeks = [];
  for (let i = 5; i >= 0; i--) {
    const date = new Date(today.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const year = date.getFullYear();
    const firstJan = new Date(year, 0, 1);
    const dayOfYear = Math.floor((date - firstJan) / (1000 * 60 * 60 * 24));
    const weekNum = Math.ceil((dayOfYear + firstJan.getDay() + 1) / 7);
    last6Weeks.push(`FW${weekNum}-${year}`);
  }
  
  


  // Map labels exactly as received (keep FWxx-YYYY format)
  const labelToValue = {};
  kpiData.labels.forEach((label, i) => {
    labelToValue[label] = kpiData.values[i];
  });

    

    // Build complete series for display, using fallback null for missing data
    const labels = last6Weeks;
    const values = last6Weeks.map(l => labelToValue[l] ?? null);
    
    

    // Find latest and previous values to calculate variation
    const recentValid = values.filter(v => v !== null && v !== undefined && v !== 0);
    const latest = recentValid.at(-1);
    const previous = recentValid.length > 1 ? recentValid.at(-2) : latest;

    // Updated color and arrow logic based on KPI goal
    const delta = (latest != null && previous != null)
      ? (latest - previous)
      : null;
    let arrow = '→';
    let arrowColor = 'text-secondary';

    if (goal === 'maximize') {
      if (delta > 0.5) {
        arrow = '↑';
        arrowColor = 'text-success';
      } else if (delta < -0.5) {
        arrow = '↓';
        arrowColor = 'text-danger';
      }
    } else if (goal === 'minimize') {
      if (delta > 0.5) {
        arrow = '↑';
        arrowColor = 'text-danger';
      } else if (delta < -0.5) {
        arrow = '↓';
        arrowColor = 'text-success';
      }
    }


    // Create the KPI card container
    const card = document.createElement("div");
    card.className = "kpi-card";

    // Create the expand button
    const expandBtn = document.createElement("div");
    expandBtn.className = "expand-btn";
    expandBtn.innerHTML = '<i class="fas fa-expand-arrows-alt"></i>'; // Add the icon for the expand button
    expandBtn.onclick = () => expandMaintenanceKPI(kpiName); // Define the behavior when the expand button is clicked

    // Create the info button
    const infoBtn = document.createElement("div");
    infoBtn.className = "info-btn";
    infoBtn.innerHTML = '<i class="fas fa-info-circle"></i>'; // Add the info icon

    // Handle the behavior for clicking the info button
    infoBtn.onclick = (e) => {
      e.stopPropagation(); // Prevent the event from bubbling up to parent elements

      // Check if an existing info bubble is already present
      const existing = infoBtn.parentElement.querySelector('.info-bubble');
      if (existing) {
        existing.remove(); // If a bubble exists, remove it to toggle the info
        return; // Exit the function after removing the bubble
      }

      // Create a new info bubble
      const bubble = document.createElement('div');
      bubble.className = 'info-bubble';
      bubble.innerHTML = getMaintenanceKpiExplanation(kpiName); // Get the description for the current KPI

      // Position the bubble correctly on the screen
      bubble.style.position = 'absolute';
      bubble.style.top = '36px'; // Position the bubble right below the info button
      bubble.style.left = '50%'; // Center it horizontally relative to the info button
      bubble.style.transform = 'translateX(-50%)'; // Adjust for centering
      bubble.style.zIndex = 9999; // Ensure the bubble is on top of other elements

      // Append the bubble to the parent of the info button (which is already positioned)
      infoBtn.parentElement.appendChild(bubble);

      // Set up a listener to close the bubble if the user clicks outside
      const closeHandler = (ev) => {
        if (!bubble.contains(ev.target) && !infoBtn.contains(ev.target)) {
          bubble.remove(); // Remove the bubble if the user clicks outside
          document.removeEventListener('click', closeHandler); // Remove the close event listener
        }
      };

      // Add the event listener for closing the bubble when clicking outside
      document.addEventListener('click', closeHandler, { once: true }); // Run only once

    };



    
    

    const header = document.createElement("div");
    header.className = "w-100 px-1 mb-1 d-flex flex-column";

    const title = document.createElement("div");
    title.className = "kpi-name text-start flex-grow-1";
    title.style.fontSize = "1.05rem";
    title.style.wordBreak = "break-word";
    title.textContent = kpiName.replace(/\s*\([^)]+\)/, '');

    const secondRow = document.createElement("div");
    secondRow.className = "d-flex justify-content-between align-items-center w-100";
    secondRow.style.fontSize = "0.9rem";
    secondRow.style.marginTop = "-0.3rem";

    const match = kpiName.match(/\(([^)]+)\)/);
    const unit = document.createElement("div");
    unit.className = "text-muted fw-bold";
    unit.textContent = match ? match[0] : '';

    const numbers = document.createElement("div");
    numbers.className = arrowColor;
    numbers.style.fontWeight = "bold";
    numbers.style.fontSize = "1.05rem";
    numbers.style.whiteSpace = "nowrap";
    numbers.textContent = (latest !== null && previous !== null)
      ? `${arrow} ${delta.toFixed(1)}`
      : 'No data';
    

    secondRow.appendChild(unit);
    secondRow.appendChild(numbers);
    header.appendChild(title);
    header.appendChild(secondRow);

    card.appendChild(expandBtn);
    card.appendChild(infoBtn);
    card.appendChild(header);

    const canvas = document.createElement("canvas");
    canvas.height = 280; // Force la hauteur du graphique compact

    card.appendChild(canvas);
    container.appendChild(card);

    const ctx = canvas.getContext("2d");

    // Color bars based on whether they meet the threshold
    const barColors = values.map(v => {
      if (v === null || isNaN(threshold)) return '#cccccc'; // Grey if no data or no threshold
      const isRed = (goal === 'maximize' && v < threshold) || (goal === 'minimize' && v > threshold);
      return isRed ? '#dc3545' : '#28a745'; // Red if bad, green if good
    });

    // Render the compact bar chart
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: barColors
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          annotation: {
            annotations: !isNaN(threshold) ? {
              thresholdLine: {
                type: 'line',
                yMin: threshold,
                yMax: threshold,
                borderColor: 'red',
                borderWidth: 2,
                label: {
                  display: true,
                  content: `Threshold: ${threshold}`,
                  position: 'end',
                  backgroundColor: 'rgba(255,255,255,0.8)',
                  color: 'red',
                  font: {
                    weight: 'bold'
                  }
                }
              }
            } : {}
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(val, index) {
                return val.toFixed(0);
              }            
            }
          }
        }
      },
      plugins: [Chart.registry.getPlugin('annotation')]
    });    
  }
}

// Utility function to get the Monday date of a given ISO week number and year
function getMondayOfISOWeek(week, year) {
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const day = simple.getDay();
  const isoMonday = new Date(simple);
  if (day <= 4)
    isoMonday.setDate(simple.getDate() - simple.getDay() + 1); // Monday of this week
  else
    isoMonday.setDate(simple.getDate() + 8 - simple.getDay()); // Monday of next week
  return isoMonday;
}

// Display a fullscreen overlay with an expanded view of the selected KPI (historical trend)
async function expandMaintenanceKPI(name) {
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlayTitle");
  overlay.style.display = "flex";
  overlayTitle.textContent = name;

  const chartCanvas = document.getElementById("expandedChart");
  const ctx = chartCanvas.getContext("2d");

  // Destroy previous chart if any
  if (window.expandedMaintenanceChart instanceof Chart) {
    window.expandedMaintenanceChart.destroy();
    window.expandedMaintenanceChart = null;
  }
  

  // Load KPI data from backend
  const res = await fetch(`/api/maintenance/kpi?range=12m&timeframe=${expandedTimeframeDays}`);
  const kpiRaw = await res.json();
  const data = kpiRaw.kpis[name];

  const now = new Date();
  const weeksToDisplay = [];
  const msPerDay = 1000 * 60 * 60 * 24;
  
  for (let i = 0; i <= expandedTimeframeDays / 7; i++) {
    const date = new Date(now.getTime() - i * 7 * msPerDay);
    const year = date.getFullYear();
    const firstJan = new Date(year, 0, 1);
    const dayOfYear = Math.floor((date - firstJan) / msPerDay);
    const weekNum = Math.ceil((dayOfYear + firstJan.getDay() + 1) / 7);
    const weekLabel = `FW${weekNum}-${year}`;
    if (!weeksToDisplay.includes(weekLabel)) {
      weeksToDisplay.unshift(weekLabel);
    }
    
  }

  // Map raw KPI data to a dictionary for easy lookup
  const valueMap = {};
  // Map raw KPI data to a dictionary: FWxx only (strip year)
  data.labels.forEach((weekLabel, i) => {
    valueMap[weekLabel] = data.values[i];
  });
  

  // Prepare labels and values for chart rendering
  const chartLabels = weeksToDisplay;
  const chartValues = weeksToDisplay.map(weekLabel => valueMap[weekLabel] ?? null);




  // Load threshold and goal (maximize/minimize) from the backend
  const prefsRes = await fetch(`/api/get-threshold?kpi=${encodeURIComponent(name)}`);
  const prefs = await prefsRes.json();
  const threshold = parseFloat(prefs.threshold);
  const goal = prefs.goal === "minimize" ? "minimize" : "maximize";

  document.getElementById("thresholdInput").value = isNaN(threshold) ? '' : threshold;
  document.getElementById(goal === "maximize" ? "maximize" : "minimize").checked = true;

  // Build optional machine overlays if checkboxes are selected
    let selectedMachines = machineFiltersByKpi[name] || [];

    document.querySelectorAll('.machine-filter').forEach(cb => {
      cb.checked = selectedMachines.includes(cb.value);
    });

    document.querySelectorAll('.machine-filter').forEach(cb => {
      cb.onchange = () => {
        const updated = [...document.querySelectorAll('.machine-filter')]
          .filter(cb => cb.checked)
          .map(cb => cb.value);

        machineFiltersByKpi[name] = updated;
        expandMaintenanceKPI(name);
      };
    });



    const machineOverlays = selectedMachines.map((machine, idx) => {
      const raw = data.machines?.[machine] || [];
      const labelToValue = {};
      data.labels.forEach((weekLabel, i) => {
        labelToValue[weekLabel] = raw[i];
      });
      const aligned = weeksToDisplay.map(weekLabel => labelToValue[weekLabel] ?? null);
      
    
      return {
        label: machine,
        data: aligned,
        type: 'line',
        borderColor: ['#FF5733', '#33B5FF', '#33FF57', '#FF33A8', '#FFC733', '#8A33FF', '#33FFF6', '#B833FF'][idx % 8],
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 3,
        fill: false,
        order: 1
      };
    });
    

  const backgroundColors = chartValues.map(v => {
    if (v === null || isNaN(threshold)) return '#cccccc';
    const isRed = (goal === 'maximize' && v < threshold) || (goal === 'minimize' && v > threshold);
    return isRed ? '#dc3545' : '#28a745';
  });

  // Render the expanded KPI chart
  window.expandedMaintenanceChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels : chartLabels,
      datasets: [
        {
          data: chartValues,
          backgroundColor: backgroundColors,
          order: 2
        },
        ...machineOverlays
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: selectedMachines.length > 0,
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
          annotations: isNaN(threshold) ? {} : {
            thresholdLine: {
              type: 'line',
              yMin: threshold,
              yMax: threshold,
              borderColor: 'red',
              borderWidth: 2,
              label: {
                display: true,
                content: `Threshold: ${threshold}`,
                position: 'end'
              }
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true
        }
      }
    },
    plugins: [Chart.registry.getPlugin('annotation')]
  });

  // Make machine checkboxes visible and active
  document.querySelectorAll('.machine-filter').forEach(el => {
    if (name === 'Maintenance Operation Efficiency (%)') {
      el.parentElement.style.display = 'none';
      el.disabled = true;
    } else {
      el.parentElement.style.display = 'inline-block';
      el.disabled = false;
    }
  });
  

  document.querySelectorAll('.machine-filter').forEach(cb => {
    cb.addEventListener('change', () => expandMaintenanceKPI(name));
  });
  

  // Trigger save on threshold or goal update
  document.getElementById("thresholdInput").onchange = async () => {
    const newThreshold = parseFloat(document.getElementById("thresholdInput").value);
    const newGoal = document.getElementById("maximize").checked ? "maximize" : "minimize";
    await saveThreshold(name, newThreshold, newGoal);
    await drawMaintenanceKpis();
    expandMaintenanceKPI(name);
  };

  document.getElementById("maximize").onchange =
  document.getElementById("minimize").onchange = async () => {
    const newThreshold = parseFloat(document.getElementById("thresholdInput").value);
    const newGoal = document.getElementById("maximize").checked ? "maximize" : "minimize";
    await saveThreshold(name, newThreshold, newGoal);
    await drawMaintenanceKpis();
    expandMaintenanceKPI(name);
  };
}

// Close the expanded KPI overlay and destroy any loaded chart
function closeOverlay() {
  const overlay = document.getElementById("overlay");
  overlay.style.display = "none";
  if (window.expandedMaintenanceChart && typeof window.expandedMaintenanceChart.destroy === 'function') {
    window.expandedMaintenanceChart.destroy();
    window.expandedMaintenanceChart = null;
  }
}

// Setup info bubble toggle behavior for the benchmarking info section
function setupBenchmarkInfoToggle() {
  const infoBtn = document.getElementById("benchmarkInfoBtn");
  const bubble = document.getElementById("benchmarkInfoBubble");

  if (!infoBtn || !bubble) return;

  infoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
  
    const bubble = document.getElementById("benchmarkInfoBubble");
  
    // Toggle visibility
    if (bubble.style.display === "block") {
      bubble.style.display = "none";
      return;
    }
  
    // Show it right below the icon
    bubble.style.display = "block";
    bubble.style.position = "absolute";
    bubble.style.top = "100%";          // just below the icon
    bubble.style.left = "50%";
    bubble.style.transform = "translateX(-50%)";
    bubble.style.marginTop = "8px";     // slight gap
    bubble.style.zIndex = "9999";       // above everything
  
    // Click outside to close
    document.addEventListener("click", function handler(ev) {
      if (!bubble.contains(ev.target) && !infoBtn.contains(ev.target)) {
        bubble.style.display = "none";
        document.removeEventListener("click", handler);
      }
    }, { once: true });
  });
  
}

// Load full KPI dataset from backend (12-month range) and store it globally
async function loadKpiData() {
  const res = await fetch('/api/maintenance/kpi?range=12m');
  const data = await res.json();
  dataByKpi_maintenance = data.kpis || {};
  drawMaintenanceKpis();
}

// Save the threshold and goal (maximize or minimize) for a given KPI into the database
async function saveThreshold(kpiName, threshold, goal) {
  try {
    await fetch('/api/save-threshold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kpi: kpiName, threshold, goal })
    });
  } catch (err) {
    console.error('Failed to save threshold:', err);
  }
}

// Set the timeframe for expanded KPI view and trigger chart refresh accordingly
function setTimeframe(days) {
  expandedTimeframeDays = days;
  // If the overlay is open, refresh the chart with the new timeframe
  const titleEl = document.getElementById("overlayTitle");
  // Highlight the active filter button
  document.querySelectorAll('.btn-sm').forEach(btn => {
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-outline-primary');
  });
  const selector = `.btn-sm[onclick*="${days}"]`;
  const activeBtn = document.querySelector(selector);
  if (activeBtn) {
    activeBtn.classList.remove('btn-outline-primary');
    activeBtn.classList.add('btn-primary');
  }

  if (titleEl && titleEl.textContent) {
    expandMaintenanceKPI(titleEl.textContent); // Reopen with same KPI name
  }
}

// Return a string description/explanation for a given maintenance KPI name
function getMaintenanceKpiExplanation(kpiName) {
  switch (kpiName) {
    case 'Mean Downtime (h)':
      return 'Average duration of each unplanned downtime.<br><i>Formula: Total Unplanned Downtime ÷ Number of Events</i>';

    case 'MTBF (h)':
      return 'Average time between two failures.<br><i>Formula: Operating Time ÷ Number of Failures</i>';

    case 'Frequency of Machine Interventions (interventions/week)':
      return 'Weekly count of maintenance interventions.<br><i>Formula: Number of Interventions per Week</i>';

    case 'Maintenance Operation Efficiency (%)':
      return 'Efficiency in maximizing runtime between failures while minimizing repair time.<br><i>Formula: (MTBF ÷ (MTBF + MDT)) × 100</i>';

    default:
      return 'No description available.';
  }
}

// Fetch and render benchmark scores for each ply cutter (based on MTBF, MDT, and DT)
async function loadMachineBenchmark() {
  const container = document.getElementById("benchmarkingContent");
  container.innerHTML = "";

  try {
    const res = await fetch("/api/maintenance/benchmark");
    const data = await res.json();
    const machines = data.machines?.slice(0, 8) || [];

    // Calcule les moyennes globales
    const avgDT = machines.reduce((sum, m) => sum + m.dt, 0) / machines.length;
    const avgMDT = machines.reduce((sum, m) => sum + m.mdt, 0) / machines.length;
    const avgMTBF = machines.reduce((sum, m) => sum + m.mtbf, 0) / machines.length;


    machines.forEach(m => {
      const card = document.createElement("div");
      card.className = "card";

      card.style.cursor = "pointer";
      const plyCutterName = m.name?.split(":")[0] || m.plyCutter || "";
      card.onclick = () => showLogsOverlay(plyCutterName);
      


      if (m.score <= 30) {
        card.style.backgroundColor = "hsl(0, 75%, 95%)";  // light red
        card.style.border = "1px solid hsl(0, 60%, 75%)"; // matching border      
      }

      const canvas = document.createElement("canvas");
      canvas.width = 120;
      canvas.height = 60;

      const ctx = canvas.getContext("2d");
      const centerX = canvas.width / 2;
      const centerY = canvas.height;
      const radius = 50;
      const startAngle = Math.PI;
      const endAngle = Math.PI * (1 + m.score / 100);

      for (let i = 0; i <= 10; i++) {
        const angle = Math.PI + (i * Math.PI / 10);
        const innerRadius = radius - 6;
        const outerRadius = radius;
        const x1 = centerX + innerRadius * Math.cos(angle);
        const y1 = centerY + innerRadius * Math.sin(angle);
        const x2 = centerX + outerRadius * Math.cos(angle);
        const y2 = centerY + outerRadius * Math.sin(angle);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = '#bbb';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, Math.PI, 2 * Math.PI);
      ctx.strokeStyle = "#e0e0e0";
      ctx.lineWidth = 10;
      ctx.stroke();

      const scoreColor = getColorFromScore(m.score);

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.strokeStyle = scoreColor;
      ctx.lineWidth = 10;
      ctx.stroke();
      

      const needleAngle = Math.PI + (Math.PI * m.score / 100);
      const needleStart = 30;
      const needleLength = radius - 8;
      const sx = centerX + needleStart * Math.cos(needleAngle);
      const sy = centerY + needleStart * Math.sin(needleAngle);
      const nx = centerX + needleLength * Math.cos(needleAngle);
      const ny = centerY + needleLength * Math.sin(needleAngle);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(nx, ny);
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.font = "600 16px 'Segoe UI'";
      ctx.fillStyle = "#333";
      ctx.textAlign = "center";
      ctx.fillText(`${m.score}`, centerX, centerY - 2);

      // Title
      const label = document.createElement("div");
      label.className = "card-title";
      label.textContent = m.name;

      // KPIs
      const details = document.createElement("div");
      details.className = "kpi-lines";
      details.innerHTML = `
        <div class="kpi-line"><span>Total Downtime</span><span style="color: ${m.dt <= avgDT ? '#28a745' : '#dc3545'}">${m.dt} h</span></div>
        <div class="kpi-line"><span>Mean Downtime</span><span style="color: ${m.mdt <= avgMDT ? '#28a745' : '#dc3545'}">${m.mdt} h</span></div>
        <div class="kpi-line"><span>MTBF</span><span style="color: ${m.mtbf >= avgMTBF ? '#28a745' : '#dc3545'}">${m.mtbf} h</span></div>
      `;
    

      card.appendChild(label);
      card.appendChild(canvas);
      card.appendChild(details);
      container.appendChild(card);
    });
  } catch (err) {
    console.error("❌ Failed to load machine benchmark:", err);
    container.innerHTML = "<p class='text-danger'>Failed to load benchmark data.</p>";
  }
}

// Show overlay displaying recent maintenance logs for a specific ply cutter
async function showLogsOverlay(plyCutter) {
  const overlay = document.getElementById("logOverlay");
  const title = document.getElementById("logOverlayTitle");
  const content = document.getElementById("logContent");

  overlay.style.display = "flex";
  
  title.textContent = `Recent Logs – ${plyCutter}`;
  content.textContent = 'Loading...';

  try {
    const res = await fetch(`/api/logs/${plyCutter}`);
    const logs = await res.json();

    if (!logs.length) {
      content.innerHTML = "<p class='text-muted'>No logs available.</p>";
      return;
    }

    content.innerHTML = logs.map(log => `
      <div class="log-entry">
        <strong>${log.reason || 'Unspecified'}</strong>
        <small>${formatToAustinTime12h(log.start_time)} → ${formatToAustinTime12h(log.end_time)}</small>
        <em>${log.duration}h</em> – WO: ${log.work_order || 'N/A'}<br>
        ${log.comment ? `<div>${log.comment}</div>` : ''}
      </div>
    `).join('');
    
  } catch (err) {
    content.innerHTML = "<p class='text-danger'>Failed to load logs.</p>";
  }
}

// Hide the logs overlay and clear its content
function closeLogOverlay() {
  document.getElementById("logOverlay").style.display = "none";
}

// Generate alert cards based on maintenance summary data (e.g., recurring faults, long downtime)
async function renderMaintenanceAlerts(data) {
  const alertRow = document.querySelector(".alert-row");
  alertRow.innerHTML = ''; // Clear previous alerts

   // 🔎 Récupère les statuts courants (UP/DOWN)
  let statusMap = new Map();
  try {
    const statusRes = await fetch('/api/get-all-status');
    const machines = await statusRes.json();
    machines.forEach(m => statusMap.set((m.plyCutter || '').toUpperCase(), (m.status || '').toUpperCase()));
  } catch (e) {
    console.warn('⚠️ Unable to load current statuses, will show alerts without UP/DOWN filtering.');
  }

  // 1. Downtime Trend Alert
  const { current_30_days, previous_30_days } = data.downtimeTrend || {};
  if (typeof current_30_days === 'number' && typeof previous_30_days === 'number' && current_30_days > 0) {
    const variation = ((current_30_days - previous_30_days) / current_30_days) * 100;
    const trendBox = document.createElement("div");
    trendBox.className = 'alert-box';
    trendBox.classList.add(variation <= -30 ? 'alert-success' : 'alert-danger');
    trendBox.innerHTML = `
      <div class="alert-title">Downtime Trend</div>
      <div class="alert-body">
        ${variation <= -30
          ? '✅ Downtime improved by <strong>' + Math.abs(variation).toFixed(0) + '%</strong> vs last month.'
          : '❌ Downtime got worse by <strong>' + variation.toFixed(0) + '%</strong> compared to last month.'}
      </div>
    `;
    alertRow.appendChild(trendBox);
  }
  

  // 2. Recurring Issues Alert
  const repeatFaults = data.recurringIssues || [];
  const worst = repeatFaults.reduce((max, pc) =>
    pc.count > max.count ? pc : max, { plyCutter: '', count: 0 });

  if (worst.count > 3) {
    const repeatBox = document.createElement("div");
    repeatBox.className = 'alert-box';
    repeatBox.classList.add('alert-danger');
    repeatBox.innerHTML = `
      <div class="alert-title">Recurring Issues</div>
      <div class="alert-body">
        ${worst.plyCutter} was down <strong>${worst.count} times</strong> this month.
      </div>`;
    alertRow.appendChild(repeatBox);
  }

  // ----- (3) Long Downtime Alert (recalculé sur la panne en cours) -----
  /*
    Objectif :
    - Ne pas utiliser data.longDowntime (cumul historique sur la période)
    - Afficher seulement si la machine est ACTUELLEMENT DOWN ET que la durée de la panne en cours >= 24h
    - Durée = now - activeLog.start_time de CETTE panne (pas le cumul des anciennes)
  */

  // 1) Liste des machines actuellement DOWN
  const downNow = [];
  statusMap.forEach((status, pc) => {
    if (status === 'DOWN') downNow.push(pc);
  });

  // 2) Récupère en parallèle l'activeLog de chaque machine DOWN
  const activeLogs = await Promise.all(
    downNow.map(async (pc) => {
      try {
        const res = await fetch(`/get_logs?plyCutter=${encodeURIComponent(pc)}`, { method: 'GET', cache: 'no-store' });
        const { activeLog } = await res.json();
        // On ne garde que si l'activeLog existe ET qu'il a un start_time
        if (activeLog && (activeLog.start_time_raw || activeLog.start_time)) {
          const startIso = activeLog.start_time_raw || activeLog.start_time; // selon ton backend
          return { pc, startIso };
        }
      } catch (e) {
        console.warn(`⚠️ Unable to load activeLog for ${pc}`, e);
      }
      return null;
    })
  );

  // 3) Calcule la durée en heures pour la panne EN COURS (pas le cumul)
  const nowTs = Date.now();
  const ongoingLongDown = (activeLogs.filter(Boolean) || []).map(({ pc, startIso }) => {
    const startTs = new Date(startIso).getTime();
    const hours = Math.max(0, (nowTs - startTs) / (1000 * 60 * 60));
    return { plyCutter: pc, hours };
  }).filter(m => m.hours >= 24); // Seuil 24h

  // 4) Affiche les alertes correspondantes
  for (const m of ongoingLongDown) {
    const longBox = document.createElement("div");
    longBox.className = 'alert-box';
    longBox.classList.add(m.hours >= 48 ? 'alert-danger' : 'alert-danger'); // même style, ajuste si besoin
    longBox.innerHTML = `
      <div class="alert-title">Long Downtime</div>
      <div class="alert-body">
        ${m.plyCutter} has been down for <strong>${Math.floor(m.hours)}</strong> hours.
      </div>`;
    alertRow.appendChild(longBox);
  }

  // Limit the number of alerts to 3
  while (alertRow.children.length > 3) {
    alertRow.removeChild(alertRow.lastChild);
  }

}

let downtimeExpandedChart = null;
let downtimeTimeframeDays = 90;

let currentDowntimeRange = '1w';

// Update global downtime range and refresh the expanded chart view
function setDowntimeRange(range) {
  currentDowntimeRange = range;

  if (range === '1w') downtimeTimeframeDays = 7;
  else if (range === '1m') downtimeTimeframeDays = 30;
  else if (range === '3m') downtimeTimeframeDays = 90;

  expandDowntimeKPI(document.getElementById("downtimeDetailTitle").textContent);
  document.querySelectorAll('#downtimeDetailOverlay .btn-outline-primary').forEach(btn => {
    btn.classList.remove('btn-primary');
  });
  document.querySelector(`#downtimeDetailOverlay button[onclick*="${range}"]`).classList.add('btn-primary');

  
}

// Fetch current downtime total and variation, and update the downtime summary card
async function updateDowntimeCard() {
  try {
    const res = await fetch('/api/maintenance/summary');
    const data = await res.json();

    const total = data.total_downtime_hours;
    const delta = data.difference_vs_previous;

    const deltaEl = document.getElementById("downtimeCardDelta");

    // Supprimer toute classe qui forcerait le rouge
    deltaEl.classList.remove("text-danger", "text-success", "text-secondary");

    // Appliquer la couleur manuellement
    if (delta <= 0) {
      deltaEl.style.setProperty('color', '#28a745', 'important');
    } else {
      deltaEl.style.setProperty('color', '#dc3545', 'important');
    }

    // Affichage du texte
    deltaEl.textContent = `${delta >= 0 ? '+' : ''}${delta}h`;
    document.getElementById("downtimeCardTotal").textContent = `${total}h`;

  } catch (err) {
    console.error("❌ Failed to update downtime card:", err);
  }
}

// Show a confirmation popup to redirect the user to a specific ply cutter's maintenance screen
function showRedirectPrompt(machineName) {
  // Remove any existing overlay
  const existing = document.getElementById('redirectOverlay');
  if (existing) existing.remove();

  // Create full-screen overlay
  const overlay = document.createElement('div');
  overlay.id = 'redirectOverlay';
  overlay.style.position = 'fixed';
  overlay.style.top = 0;
  overlay.style.left = 0;
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.zIndex = 9999;

  // Create the popup box
  const box = document.createElement('div');
  box.style.background = '#fff';
  box.style.padding = '2rem 3rem';
  box.style.borderRadius = '12px';
  box.style.boxShadow = '0 6px 18px rgba(0,0,0,0.3)';
  box.style.textAlign = 'center';
  box.style.maxWidth = '90%';
  box.style.fontSize = '1.5rem';

  const message = document.createElement('div');
  message.textContent = `You will be redirected to ${machineName} maintenance screen.`;
  message.style.marginBottom = '2rem';
  message.style.fontWeight = 'bold';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-lg btn-outline-secondary me-3';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => overlay.remove();

  const goBtn = document.createElement('button');
  goBtn.className = 'btn btn-lg btn-primary';
  goBtn.textContent = 'Go';
  goBtn.onclick = () => {
    window.location.href = `http://localhost:3000/maintenance_screen/${machineName}`;
  };

  box.appendChild(message);
  box.appendChild(cancelBtn);
  box.appendChild(goBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

// Main entry point: load all components and initialize the Maintenance KPI dashboard
startMaintenanceKpiApp = async function () {
  const start = performance.now();

  // Test chaque composant séparément
  console.time("loadKpiData");
  await loadKpiData();
  console.timeEnd("loadKpiData");

  console.time("loadMachineBenchmark");
  await loadMachineBenchmark();
  console.timeEnd("loadMachineBenchmark");

  console.time("loadMachineStatuses");
  await loadMachineStatuses();
  console.timeEnd("loadMachineStatuses");

  console.time("loadDowntimeContributors");
  await loadDowntimeContributors();
  console.timeEnd("loadDowntimeContributors");

  console.time("updateDowntimeCard");
  await updateDowntimeCard();
  console.timeEnd("updateDowntimeCard");

  console.time("renderMaintenanceAlerts");
  const summary = await fetch('/api/maintenance/summary').then(r => r.json());
  await renderMaintenanceAlerts(summary);
  console.timeEnd("renderMaintenanceAlerts");

  const end = performance.now();
  console.log(`⏱️ TOTAL LOAD TIME: ${(end - start) / 1000}s`);
  if (!document.getElementById('machineStatusList')) {
    console.warn('Maintenance view not loaded — skipping startKpiApp.');
    return;
  }

  currentDowntimeRange = '1w';
  downtimeTimeframeDays = 7;

  // Exécute tous les fetchs importants en parallèle
Promise.all([
  updateDowntimeCard(),
  loadMachineStatuses(),
  loadDowntimeContributors(),
  loadKpiData(),
  loadMachineBenchmark(),
  fetch('/api/maintenance/summary').then(res => res.json())
])
.then(async ([_, __, ___, ____, _____, summaryData]) => {
  // ✅ Assure que les alertes tiennent compte du statut UP/DOWN
  await renderMaintenanceAlerts(summaryData);

  setupBenchmarkInfoToggle();

  // ✅ Wait until all key UI blocks are rendered before hiding the loading screen
  window.kpiMaintenanceRenderComplete = () => {
    const benchmarkCards = document.querySelectorAll('#benchmarkingContent .card').length;
    const downtimeCanvas = document.querySelector('#downtimeChart');
    const machineTiles = document.querySelectorAll('#machineStatusList .machine-tile').length;

    const downtimeReady = downtimeCanvas && downtimeCanvas.offsetHeight > 100;
    const benchmarkReady = benchmarkCards >= 6;
    const machinesReady = machineTiles >= 8;

    if (benchmarkReady && downtimeReady && machinesReady) {
      if (window.maintenanceLoadingComplete) window.maintenanceLoadingComplete();
    } else {
      // Retry until other parts are loaded
      setTimeout(window.kpiMaintenanceRenderComplete, 100);
    }
  };

  // ⏳ Start waiting loop after a short delay to give DOM time to populate
  setTimeout(window.kpiMaintenanceRenderComplete, 200);
})
.catch(err => {
  console.error('❌ Error during maintenance startup:', err);
});

  
  

  // Met à jour les boutons du filtre par défaut
  document.querySelectorAll('#downtimeDetailOverlay .btn-outline-primary').forEach(btn => {
    btn.classList.remove('btn-primary');
  });
  const btn1w = document.querySelector('#downtimeDetailOverlay button[onclick*="1w"]');
  if (btn1w) btn1w.classList.add('btn-primary');
  }

  // Expose the entry point globally
  window.startMaintenanceKpiApp = startMaintenanceKpiApp;
  window.expandedMaintenanceChart = null;
  window.setTimeframe = setTimeframe;
  window.expandMaintenanceKPI = expandMaintenanceKPI;
  window.closeOverlay = closeOverlay;
  window.closeLogOverlay = closeLogOverlay;
  window.loadDowntimeContributors = loadDowntimeContributors;
  window.setDowntimeRange = setDowntimeRange;
  window.loadMachineStatuses = loadMachineStatuses;

})();