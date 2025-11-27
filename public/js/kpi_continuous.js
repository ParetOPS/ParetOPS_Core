/**
 * kpi_continuous.js - CONFIDENTIAL - PROPERTY OF PARETOPS
 *
 * For technical support, contact: support@paretops.com
 *
 * DESCRIPTION:
 * This JavaScript module manages the full DMAIC lifecycle for Continuous Improvement (CI) projects
 * within the ParetOPS platform. It supports phase rendering, project saving, KPI selection, benchmarking,
 * statistical analysis, data visualization, and real-time feedback based on measured KPIs.
 *
 * PURPOSE:
 * - Load and render CI projects from the backend.
 * - Walk users through DMAIC steps: Define, Measure, Analyze, Improve, Control, Closure.
 * - Display KPI trends, perform statistical analysis (mean, std dev, CV, histogram, Gaussian).
 * - Render and persist all text inputs, selected machines, timeline filters, and visual outputs.
 * - Allow multi-format saving (metadata, histograms, Pareto charts, comparison charts).
 *
 * FEATURES:
 * - DMAIC phase rendering with modular section toggles.
 * - Integrated Chart.js visualizations (boxplot, histogram, Gaussian curves).
 * - Real-time updates and comparisons of KPI data pre/post-improvement.
 * - Advanced data freeze and reload capabilities per project and phase.
 * - Auto-save feedback indicators , and button states (loading spinners).
 * - Pareto generation and multi-graph export (trend, histogram, dual comparison).
 *
 * DEPLOYMENT:
 * - Linked from `continuous_improvement_kpi.html`.
 * - Depends on backend API routes:
 *   • `/api/kpi`
 *   • `/api/maintenance/kpi`
 *   • `/api/get-projects`, `/api/create-project`, `/api/delete-project/:id`
 *   • `/api/define/:projectId`, `/api/projects/:id/status`, `/api/close/:id`, etc.
 *   • See in-code documentation for more.
 *
 * DEPENDENCIES:
 * - Chart.js (bar, line, scatter support)
 * - Bootstrap Modals (for new project creation)
 * - Custom styling from `continuous_improvement_kpi.html`
 * - Global helper `formatAustinDate()` and utility functions
 *
 * AUTHOR:
 * Paulin Colin BANCKAERT — Continuous Improvement Module v3.0.0
 *
 * VERSIONING:
 * - Managed under Git.
 * - All changes to phase rendering, data model, or backend endpoints must be tagged.
 */


// Global project array
let ciProjects = [];
const dataByKpi = {}; 


window.kpis = [
  // Production KPIs
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
  { name: 'Help Request Response Time (min)' },

  // Maintenance KPIs
  { name: 'Mean Downtime (h)' },
  { name: 'Frequency of Machine Interventions (interventions/week)' },
  { name: 'MTBF (h)' },
  { name: 'Maintenance Operation Efficiency (%)' }
];

function formatAustinDate(isoDateString) {
  const date = new Date(isoDateString);
  return date.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

async function loadProductionData() {
  try {
    const [prodRes, maintRes] = await Promise.all([
      fetch("/api/kpi"),
      fetch("/api/maintenance/kpi")
    ]);

    const prodData = await prodRes.json();
    const maintData = await maintRes.json();

    if (!prodData.kpis && !maintData.kpis) {
      console.warn("❌ No KPI data found from either production or maintenance backend.");
      return;
    }

    if (prodData.kpis) Object.assign(dataByKpi, prodData.kpis);
    if (maintData.kpis) Object.assign(dataByKpi, maintData.kpis);

    console.log("✅ All KPIs loaded:", Object.keys(dataByKpi));
  } catch (err) {
    console.error("❌ Failed to load KPI data:", err);
  }
}

// DMAIC project phases in order
const dmaicPhases = ["Define", "Measure", "Analyze", "Improve", "Control", "Closed"];

// Load projects from backend and render them
function loadProjects() {
  fetch('/api/get-projects')
    .then(response => response.json())
    .then(data => {
      ciProjects = data;
      renderProjectCards();
    })
    .catch(err => {
      console.error("Failed to load projects:", err);
    });
}

// Render all project cards in the selector section
function renderProjectCards() {
  const container = document.getElementById("ci-project-selector");
  container.innerHTML = "";

  ciProjects.forEach(project => {
    const card = document.createElement("div");
    let bgClass = "bg-white";
    if (project.status === "Closed") {
      if (project.outcome === "success") bgClass = "bg-success bg-opacity-10";
      else if (project.outcome === "failure") bgClass = "bg-danger bg-opacity-10";
    }
    
    if (project.status === "Closed") {
      if (project.outcome === "success") bgClass = "bg-success bg-opacity-10";
      else if (project.outcome === "failure") bgClass = "bg-danger bg-opacity-10";
    }
    card.className = `${bgClass} shadow-sm p-3 rounded border`;
            card.style.width = "250px";
    card.style.cursor = "pointer";

    card.innerHTML = `
      <div class="d-flex justify-content-between align-items-start">
        <h5 class="mb-1">${project.title}</h5>
        <button class="btn-close btn-close-sm" aria-label="Close" onclick="event.stopPropagation(); confirmDeleteProject(${project.id})"></button>
      </div>
      <small class="text-muted">Opened: ${formatDate(project.start_date)}</small><br>
      <small class="text-muted">Expected closure: ${formatDate(project.closure_date)}</small>
      <span class="badge bg-${project.status === 'Closed' ? 'secondary' : 'primary'} mt-2">
        ${project.status}
      </span>
    `;
  

    card.onclick = async () => await renderProjectDetails(project);
    container.appendChild(card);
  });
}

// Render all completed phases of a selected project
async function renderProjectDetails(project) {
  const detailContainer = document.getElementById("ci-project-details");
  window.currentProjectId = project.id;
  detailContainer.innerHTML = "";

  // Determine current phase and all phases up to it
  const currentIndex = dmaicPhases.indexOf(project.status);
  const completedPhases = dmaicPhases.slice(0, currentIndex + 1);
  // ✅ Set selectedMachine first from backend
  const machineRes = await fetch(`/api/projects/${project.id}/machines`);
  const machineList = await machineRes.json();
  window.selectedMachine = machineList?.[0] || "PC1";

  completedPhases.forEach((phase, idx) => {
    const phaseCard = document.createElement("div");

    // === Phase: Define ===
    if (phase === "Define") {
      phaseCard.innerHTML = renderDefinePhase(project);
      loadDefineData(project.id);

    }

    // === Phase: Measure ===
    else if (phase === "Measure") {
      phaseCard.innerHTML = renderMeasurePhase(project);
    }

    // === Phase: Analyze ===
    else if (phase === "Analyze") {
      phaseCard.innerHTML = renderAnalyzePhase(project);
    }

    // === Phase: Improve ===
    else if (phase === "Improve") {
      phaseCard.innerHTML = renderImprovePhase(project);
      loadImproveData(project.id);
    }

    else if (phase === "Control") {
      phaseCard.innerHTML = renderControlPhase(project);
    }

    else if (phase === "Closed") {
      phaseCard.innerHTML = renderClosePhase(project);
    }
    
    // === Other Phases (Control, Closed) ===
    else {
      phaseCard.innerHTML = renderGenericPhase(phase, project);
    }

    // Append the phase card to the container
    detailContainer.appendChild(phaseCard);
    const content = document.getElementById(`phase-content-${phase}`);
    if (content) content.classList.add('collapsed');


    // === Next Phase Button ===
    const isLast = idx === completedPhases.length - 1;
    const notClosed = phase !== "Closed";
    if (isLast && notClosed) {
      const nextPhase = dmaicPhases[idx + 1];
      if (nextPhase) {
        const nextButton = document.createElement("button");
        nextButton.className = "btn btn-success mb-4";
        nextButton.textContent = `Next: ${nextPhase}`;
        nextButton.onclick = () => moveToNextPhase(project, nextPhase);
        detailContainer.appendChild(nextButton);
      }
    }
  });
}

// Transition project to the next phase
function moveToNextPhase(project, nextPhase) {
  const saveFunctions = {
    "Define": () => saveDefineData(project.id),
    // Ajoute les autres phases ici si besoin
  };

  const currentPhase = project.status;
  const saveFn = saveFunctions[currentPhase];

  const afterSave = () => {
    document.getElementById(`phase-content-${project.status}`)?.classList.add('collapsed');
  
    fetch(`/api/projects/${project.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextPhase })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        // Reload project from fresh list to get updated status
        loadProjects();
    
        // Wait briefly to ensure renderProjectDetails uses the new status
        setTimeout(async () => {
          const updated = { ...project, status: nextPhase };
        
          // Recharge visuellement les phases
          await renderProjectDetails(updated);
        
          // Referme toutes les phases sauf la nouvelle
          dmaicPhases.forEach(phase => {
            const section = document.getElementById(`phase-content-${phase}`);
            if (section) {
              if (phase === nextPhase) {
                section.classList.remove('collapsed');
                section.scrollIntoView({ behavior: 'smooth', block: 'start' });
              } else {
                section.classList.add('collapsed');
              }
            }
          });
        }, 200);
        
      } else {
        alert("Failed to update project status.");
      }
    });
    
  };
  

  // 💡 Exécute la sauvegarde si elle existe, puis enchaîne
  if (saveFn) {
    const result = saveFn();
    if (result instanceof Promise) {
      result.then(afterSave).catch(err => {
        console.error("Error during phase save:", err);
        alert("Failed to save before moving to next phase.");
      });
    } else {
     afterSave();
    }
  } else {
    afterSave(); // Aucun besoin de sauvegarde, passe directement
  }
}

function proceedToNextPhase(project, nextPhase) {
  fetch(`/api/projects/${project.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: nextPhase })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      project.status = nextPhase;
      renderProjectDetails(project);
      loadProjects();
    } else {
      alert("Failed to update project status.");
    }
  });
}

// Show placeholder alert for unimplemented modify action
function modifyPhase(phase, projectId) {
  alert(`Modify clicked for phase "${phase}" of project #${projectId}`);
}

// Render Define phase card with project metadata
function renderDefinePhase(project) {
  setTimeout(() => {
    const select = document.getElementById("machine-select");
    const selected = window.selectedMachine || null;

    if (select) {
      // ✅ Pré-sélectionner la machine globale si définie
      if (selected && [...select.options].some(opt => opt.value === selected)) {
        select.value = selected;
      }

      select.addEventListener("change", () => {
        const machine = select.value;

        // 🔄 Met à jour la machine globale
        window.selectedMachine = machine;

        // 🔄 Met à jour l'input texte dans Analyze
        const analyzeInputs = document.querySelectorAll('#phase-content-Analyze input[type="text"]');
        analyzeInputs.forEach(input => input.value = machine);

        // 🔄 Met à jour l’attribut dataset dans Measure
        const kpiSelect = document.getElementById("measure-kpi-select");
        if (kpiSelect) {
          kpiSelect.dataset.selectedMachine = machine;
        }
      });
    }
  }, 100);

  return `
    <div class="card mb-2">
      <div 
        class="card-header d-flex justify-content-between align-items-center"
        onclick="togglePhase('Define')"
        style="cursor: pointer;"
        data-phase="Define"
      >
        <span class="fw-bold">Define</span>
      </div>

      <div id="phase-content-Define" class="card-body py-2 px-3">
        <form class="row g-2">
          <div class="col-md-6">
            <label class="form-label small mb-1">Project Title</label>
            <input type="text" class="form-control form-control-sm" id="define-title" value="${project.title || ''}">
          </div>
          <div class="col-md-6">
            <label class="form-label small mb-1">Start Date</label>
            <input type="date" class="form-control form-control-sm" id="define-start" value="${(project.start_date || '').slice(0, 10)}">
          </div>
          <div class="col-md-12">
            <label class="form-label small mb-1">Problem Definition</label>
            <textarea class="form-control form-control-sm" id="define-problem" rows="2" placeholder="Describe the issue..."></textarea>
          </div>
          <div class="col-md-6">
            <label class="form-label small mb-1">Estimated End Date</label>
            <input type="date" class="form-control form-control-sm" id="define-end" value="${(project.closure_date || '').slice(0, 10)}">
          </div>
          <div class="col-md-6">
            <label class="form-label small mb-1">Estimated Impact</label>
            <input type="text" class="form-control form-control-sm" id="define-impact" placeholder="e.g., Reduce downtime by 30%">
          </div>
          <div class="col-md-12">
            <label class="form-label small mb-1">Associated Machine</label>
            <select class="form-select form-select-sm" id="machine-select">
              ${["PC1", "PC2", "PC4", "PC5", "PC6", "PC7", "PC8", "PC9"].map(name => `
                <option value="${name}">${name}</option>
              `).join('')}
            </select>
            <div class="mt-3 text-end">
              <button class="btn btn-success" type="button" onclick="saveDefineData(${project.id})">
                Save changes
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;
}

// Render generic card for non-Define DMAIC phases
function renderGenericPhase(phase, project) {
  return `
    <div class="card mb-3">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span>${phase}</span>
        <button class="btn btn-sm btn-outline-secondary" onclick="modifyPhase('${phase}', ${project.id})">
          Modify
        </button>
      </div>
      <div class="card-body">
        <p>Content for phase <strong>${phase}</strong> will go here.</p>
      </div>
    </div>
  `;
}

// Open the modal to create a new project
function openNewProjectModal() {
  const modal = new bootstrap.Modal(document.getElementById("newProjectModal"));
  modal.show();
}

// Submit new project data to the backend and refresh the list
function submitNewProject(event) {
  event.preventDefault();

  const title = document.getElementById("newProjectTitle").value;
  const startDate = document.getElementById("newProjectStartDate").value;
  const closureDate = document.getElementById("newProjectClosureDate").value;


  fetch('/api/create-project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: title,
      start_date: startDate,
      closure_date: closureDate
    })
    
  })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        loadProjects();
        bootstrap.Modal.getInstance(document.getElementById("newProjectModal")).hide();
      } else {
        alert("Failed to create project.");
      }
    })
    .catch(err => {
      console.error("Failed to submit project:", err);
      alert("Server error while creating project.");
    });
}

// Format a raw date string into a readable format (e.g. 'Apr 3, 2025, 8:00 AM CST')
function formatDate(rawDate) {
  if (!rawDate) return '—';
  const date = new Date(rawDate);
  return date.toLocaleDateString("en-US", {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

// Load saved 'Define' phase data for the given project ID (problem, impact, metadata)
function loadDefineData(projectId) {
  // 1. Load Define-specific data
  fetch(`/api/define/${projectId}`)
    .then(res => res.json())
    .then(data => {
      if (!data) return;

      const prob = document.getElementById("define-problem");
      const impact = document.getElementById("define-impact");

      if (prob) prob.value = data.problem_definition || '';
      if (impact) impact.value = data.estimated_impact || '';
    })
    .catch(err => {
      console.error("Failed to load define data:", err);
    });

  // 2. Load project core info (title, start date, closure date)
  const project = ciProjects.find(p => p.id === projectId);
  if (project) {
    const title = document.getElementById("define-title");
    const start = document.getElementById("define-start");
    const end = document.getElementById("define-end");

    if (title) title.value = project.title || '';
    if (start) start.value = project.start_date?.slice(0, 10) || '';
    if (end) end.value = project.closure_date?.slice(0, 10) || '';
  }

  // 3. Load associated machines
  fetch(`/api/projects/${projectId}/machines`)
    .then(res => res.json())
    .then(machineList => {
      if (!Array.isArray(machineList)) return;

      const select = document.getElementById("machine-select");
      if (select && machineList.length > 0) {
        select.value = machineList[0];  // unique selection
      }

    })
    .catch(err => {
      console.error("Failed to load associated machines:", err);
    });
}

// Save all input fields and selections from the 'Define' phase into the backend
function saveDefineData(projectId) {
  const problem = document.getElementById("define-problem")?.value || '';
  const impact = document.getElementById("define-impact")?.value || '';
  const closureDate = document.getElementById("define-end")?.value || null;
  const newTitle = document.getElementById("define-title")?.value || '';
  const newStartDate = document.getElementById("define-start")?.value || '';
  const checkedMachines = [document.getElementById("machine-select").value];


  // 1. Save Define-specific data
  fetch(`/api/define/${projectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      problem_definition: problem,
      estimated_impact: impact
    })
  })
  .then(res => res.json())
  .then(data => {
    if (!data.success) {
      alert("Failed to save Define details.");
      throw new Error("Define save failed");
    }

    // 2. Update project core info
    return fetch(`/api/projects/${projectId}/core`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newTitle,
        start_date: newStartDate,
        closure_date: closureDate
      })
    });
  })
  .then(res => res.json())
  .then(result => {
    if (!result.success) {
      alert("Failed to update project details.");
      throw new Error("Project update failed");
    }

    // 3. Save selected machines
    return fetch(`/api/projects/${projectId}/machines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machines: checkedMachines })
    });
  })
  .then(res => res.json())
  .then(result => {
    if (result.success) {
      const btn = document.querySelector(`button[onclick*="saveDefineData"]`);
      if (btn) showSuccessCheckmark(btn);
      loadProjects();
    } else {
      alert("Machine assignment failed.");
    }
  })
  .catch(err => {
    console.error("Error during Define save:", err);
    alert("An error occurred while saving project data.");
  });
}

// Expand or collapse the content section of a given DMAIC phase
function togglePhase(phase, projectId) {
  const content = document.getElementById(`phase-content-${phase}`);
  if (content) {
    content.classList.toggle('collapsed');
  }
}

// MEASURE
// Render the Measure phase HTML and dropdowns for the selected project
function renderMeasurePhase(project) {
  const fallbackKpis = [
    "Changeover Time (h)",
    "Planned Downtime (h)",
    "Mean Downtime (h)",
    "MTBF (h)",
    "Frequency of Machine Interventions (interventions/week)",
    "Maintenance Operation Efficiency (%)",
    "Unplanned Downtime (h)",
    "OEE (%)",
    "Production Achievement (%)",
    "Corrective Maintenance Rate (%)",
    "Cycle Time (h)",
    "Efficiency (%)",
    "Yield (%)",
    "Active Utilization (%)",
    "Help Request Rate (calls/day)",
    "Help Request Response Time (min)"
  ];

  const ciKpis = (window.ciKpis || []).map(k => k.name);
  const allKpis = ciKpis.length > 1 ? ciKpis : fallbackKpis;

  const otherKpis = allKpis.filter(kpi => kpi !== "Availability (%)");

  return `
    <div class="card mb-3">
      <div class="card-header d-flex justify-content-between align-items-center"
           onclick="togglePhase('Measure')"
           style="cursor: pointer;"
           data-phase="Measure">
        <span class="fw-bold">Measure</span>
        <button class="btn btn-sm btn-outline-secondary"
                onclick="event.stopPropagation(); loadFrozenMeasureData(${project.id})">
          Load Saved Measure Data
        </button>
      </div>

      <div id="phase-content-Measure" class="card-body py-2 px-3">
        <form id="measure-form" onsubmit="submitMeasure(${project.id}); return false;">
          <div class="mb-3">
            <label class="form-label">Select KPIs</label>
            <select class="form-select" id="measure-kpi-select" onchange="
              Array.from(this.options).forEach((opt, i) => opt.selected = i === this.selectedIndex);
            ">
              <optgroup label="Production KPIs">
                <option value="Availability (%)">Availability (%)</option>
              </optgroup>

              <optgroup label="— Available in the next update upon request —">
                ${otherKpis
                  .map(kpi => `<option value="${kpi}" disabled>${kpi}</option>`)
                  .join('')}
              </optgroup>
            </select>
          </div>

          <div class="mb-3">
            <label class="form-label">Time range</label><br>
            <div class="btn-group" role="group">
              <input type="radio" class="btn-check" name="range" id="range7" value="7" checked>
              <label class="btn btn-outline-primary" for="range7">Past 7 days</label>

              <input type="radio" class="btn-check" name="range" id="range30" value="30">
              <label class="btn btn-outline-primary" for="range30">Past 30 days</label>

              <input type="radio" class="btn-check" name="range" id="range90" value="90">
              <label class="btn btn-outline-primary" for="range90">Past 90 days</label>
            </div>
          </div>

          <button class="btn btn-success me-2" type="submit">Generate new data</button>
        </form>

        <div id="measure-table-container" class="mt-4"></div>
        <hr class="my-4">
        <div class="text-end">
          <button class="btn btn-success" type="button" onclick="freezeTableData(${project.id})">
            Save Measure Data
          </button>
        </div>
      </div>
    </div>
  `;
}

// Process KPI selection and display the Measure table with histogram and statistics
async function submitMeasure(projectId) {
  const btn = document.querySelector('#measure-form button[type="submit"]');
  showLoading(btn, "Generating...");

  try {
    if (Object.keys(dataByKpi).length === 0) {
      console.log("⏳ Loading KPI data before generating table...");
      await loadProductionData();
    }

    const kpiSelect = document.getElementById("measure-kpi-select");
    const selectedKpi = kpiSelect.value;
    const range = parseInt(document.querySelector('input[name="range"]:checked').value);

    if (!selectedKpi) {
      alert("Please select a KPI.");
      return;
    }

    const res = await fetch(`/api/projects/${projectId}/machines`);
    const machines = await res.json();
    if (!Array.isArray(machines) || machines.length === 0) {
      alert("No machines defined for this project.");
      return;
    }

    const kpiData = dataByKpi[selectedKpi];
    if (!kpiData || !kpiData.machines || !kpiData.labels) {
      alert(`No data available for KPI "${selectedKpi}".`);
      return;
    }

    const labels = kpiData.labels;
    const allValues = [];
    let tableHTML = `
      <table class="table table-bordered text-center align-middle">
        <thead class="table-light">
          <tr><th>KPI</th><th>Machine</th><th>Date</th><th>Value</th></tr>
        </thead>
        <tbody>
    `;

    if (machines.length > 0) {
      kpiSelect.dataset.selectedMachine = machines[0];
      window.selectedMachine = machines[0];
    }

    machines.forEach(machine => {
      const values = kpiData.machines[machine] || [];
      for (let i = Math.max(0, labels.length - range); i < labels.length; i++) {
        const date = labels[i];
        const val = values[i];
        if (date && val != null && !isNaN(val)) {
          const parsed = parseFloat(val);
          allValues.push(parsed);
          tableHTML += `
            <tr>
              <td class="text-start">${selectedKpi}</td>
              <td>${machine}</td>
              <td data-raw="${date}">${formatAustinDate(date)}</td>
              <td>${parsed.toFixed(2)}</td>
            </tr>
          `;
        }
      }
    });

    tableHTML += `</tbody></table>`;

    if (allValues.length === 0) {
      alert("No values found for this KPI in the selected range.");
      return;
    }

    // === STATISTICS ===
    const count = allValues.length;
    const mean = allValues.reduce((a, b) => a + b, 0) / count;
    const sorted = [...allValues].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    const stddev = Math.sqrt(allValues.reduce((a, b) => a + (b - mean) ** 2, 0) / count);
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const rangeVal = max - min;

    // === Histogram & Gaussian
    const binCount = 10;
    const binWidth = (max - min) / binCount;
    const bins = Array(binCount).fill(0);
    const binCenters = [];

    for (let i = 0; i < binCount; i++) {
      const binStart = min + i * binWidth;
      binCenters.push(binStart + binWidth / 2);
    }

    allValues.forEach(val => {
      const idx = Math.min(Math.floor((val - min) / binWidth), binCount - 1);
      bins[idx]++;
    });

    const histogramData = binCenters.map((x, i) => ({ x, y: bins[i] }));

    const gaussX = [], gaussY = [];
    const steps = 100;
    for (let i = 0; i <= steps; i++) {
      const x = mean - 3 * stddev + (i / steps) * (6 * stddev);
      const y = (1 / (stddev * Math.sqrt(2 * Math.PI))) *
                Math.exp(-((x - mean) ** 2) / (2 * stddev ** 2));
      gaussX.push(x);
      gaussY.push(y * count * binWidth);
    }

    const gaussianData = gaussX.map((x, i) => ({ x, y: gaussY[i] }));
    const unit = selectedKpi.includes('%') ? '%' : selectedKpi.includes('(h)') ? 'h' : '';

    document.getElementById("measure-table-container").innerHTML = `
      <h5 class="mb-3">${selectedKpi}</h5>
      <div class="d-flex gap-4 flex-wrap mt-2">
        <div style="max-height: 400px; overflow-y: auto; max-width: 45%;">
          ${tableHTML}
        </div>
        <div style="flex: 1; min-width: 300px;">
          <canvas id="kpiHistogram" height="160"></canvas>

          <ul class="list-unstyled mt-3 small">
            <li><strong>Values count:</strong> ${count}</li>
            <li><strong>Max:</strong> ${max.toFixed(2)}${unit}</li>
            <li><strong>Min:</strong> ${min.toFixed(2)}${unit}</li>
            <li><strong>Mean:</strong> ${mean.toFixed(2)}${unit}</li>
            <li><strong>Median:</strong> ${median.toFixed(2)}${unit}</li>
            <li><strong>Standard deviation:</strong> ${stddev.toFixed(2)}${unit}</li>
            <li><strong>Range:</strong> ${rangeVal.toFixed(2)}${unit}</li>
          </ul>

        </div>
      </div>
    `;

    const ctx = document.getElementById("kpiHistogram").getContext("2d");
    new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [
          {
            type: 'bar',
            label: 'Histogram',
            data: histogramData,
            backgroundColor: 'rgba(0,123,255,0.7)',
            borderColor: '#000',
            borderWidth: 1.2,
            barPercentage: 0.9,
            categoryPercentage: 0.9,
            borderSkipped: false,
            order: 1
          },
          {
            type: 'line',
            label: 'Gaussian curve',
            data: gaussianData,
            borderColor: 'red',
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            order: 2
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: true },
          title: {
            display: true,
            text: `Distribution of ${selectedKpi}`,
            font: { size: 16 },
            padding: { top: 10, bottom: 10 }
          },
          tooltip: {
            callbacks: {
              label: ctx => `Count: ${ctx.raw.y}`
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            min: mean - 3 * stddev,
            max: mean + 3 * stddev,
            title: {
              display: true,
              text: 'KPI Value',
              font: { size: 14 }
            },
            ticks: {
              stepSize: Math.round((6 * stddev) / 10),
              callback: value => value.toFixed(0),
              padding: 5,
              font: { size: 12 }
            }
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Frequency',
              font: { size: 14 }
            },
            ticks: {
              padding: 5,
              font: { size: 12 }
            }
          }
        }
      }
    });

  } catch (err) {
    console.error("❌ Failed to submit Measure:", err);
    alert("An error occurred while generating data.");
  } finally {
    hideLoading(btn);
  }
}

// Load previously frozen Measure data from the backend for this project
async function loadFrozenMeasureData(projectId) {
  try {
    const res = await fetch(`/api/frozen-measure/${projectId}`);
    const result = await res.json();

    if (!result || !result.data || Object.keys(result.data).length === 0) {
      const btn = document.querySelector(`button[onclick*="loadFrozenMeasureData"]`);
      if (btn) showFailureCross(btn);
      return;
    }
    

    const kpi = Object.keys(result.data)[0];
    const dataRows = result.data[kpi];
    const range = result.range;

    const allValues = dataRows.map(d => d.value);
    const count = allValues.length;
    const mean = allValues.reduce((a, b) => a + b, 0) / count;
    const sorted = [...allValues].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    const stddev = Math.sqrt(allValues.reduce((a, b) => a + (b - mean) ** 2, 0) / count);
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const rangeVal = max - min;

    // HTML TABLE with formatted Austin time
    const tableHTML = `
      <table class="table table-bordered text-center align-middle">
        <thead class="table-light">
          <tr><th>KPI</th><th>Machine</th><th>Date</th><th>Value</th></tr>
        </thead>
        <tbody>
          ${dataRows.map(row => `
            <tr>
              <td class="text-start">${kpi}</td>
              <td>${row.machine}</td>
              <td>${formatAustinDate(row.date)}</td>
              <td>${parseFloat(row.value).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // Histogram Data
    const binCount = 10;
    const binWidth = (max - min) / binCount;
    const bins = Array(binCount).fill(0);
    const binCenters = [];

    for (let i = 0; i < binCount; i++) {
      const binStart = min + i * binWidth;
      binCenters.push(binStart + binWidth / 2);
    }

    allValues.forEach(val => {
      const idx = Math.min(Math.floor((val - min) / binWidth), binCount - 1);
      bins[idx]++;
    });

    const histogramData = binCenters.map((x, i) => ({ x, y: bins[i] }));

    // Gaussian curve
    const gaussX = [];
    const gaussY = [];
    const steps = 100;
    for (let i = 0; i <= steps; i++) {
      const x = mean - 3 * stddev + (i / steps) * (6 * stddev);
      const y = (1 / (stddev * Math.sqrt(2 * Math.PI))) *
                Math.exp(-((x - mean) ** 2) / (2 * stddev ** 2));
      gaussX.push(x);
      gaussY.push(y * count * binWidth);
    }

    const gaussianData = gaussX.map((x, i) => ({ x, y: gaussY[i] }));

    // Inject HTML
    const unit = kpi.includes('%') ? '%' : kpi.includes('(h)') ? 'h' : '';

    document.getElementById("measure-table-container").innerHTML = `
      <h5 class="mb-3">${kpi} (Frozen)</h5>
      <div class="d-flex gap-4 flex-wrap mt-2">
        <div style="max-height: 400px; overflow-y: auto; max-width: 45%;">
          ${tableHTML}
        </div>
        <div style="flex: 1; min-width: 300px;">
          <canvas id="kpiHistogram" height="160"></canvas>

          <ul class="list-unstyled mt-3 small">
            <li><strong>Values count:</strong> ${count}</li>
            <li><strong>Max:</strong> ${max.toFixed(2)}${unit}</li>
            <li><strong>Min:</strong> ${min.toFixed(2)}${unit}</li>
            <li><strong>Mean:</strong> ${mean.toFixed(2)}${unit}</li>
            <li><strong>Median:</strong> ${median.toFixed(2)}${unit}</li>
            <li><strong>Standard deviation:</strong> ${stddev.toFixed(2)}${unit}</li>
            <li><strong>Range:</strong> ${rangeVal.toFixed(2)}${unit}</li>
          </ul>

        </div>
      </div>
    `;

    // Render enhanced Chart
    const ctx = document.getElementById("kpiHistogram").getContext("2d");
    new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [
          {
            type: 'bar',
            label: 'Histogram',
            data: histogramData,
            backgroundColor: 'rgba(0,123,255,0.7)',
            borderColor: '#000',
            borderWidth: 1.2,
            barPercentage: 0.9,
            categoryPercentage: 0.9,
            borderSkipped: false,
            order: 1
          },
          {
            type: 'line',
            label: 'Gaussian curve',
            data: gaussianData,
            borderColor: 'red',
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            order: 2
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: true },
          title: {
            display: true,
            text: `Distribution of ${kpi}`,
            font: { size: 16 },
            padding: { top: 10, bottom: 10 }
          },
          tooltip: {
            callbacks: {
              label: ctx => `Count: ${ctx.raw.y}`
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            min: mean - 3 * stddev,
            max: mean + 3 * stddev,
            title: {
              display: true,
              text: 'KPI Value',
              font: { size: 14 }
            },
            ticks: {
              stepSize: Math.round((6 * stddev) / 10),
              callback: value => value.toFixed(0),
              padding: 5,
              font: { size: 12 }
            }
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Frequency',
              font: { size: 14 }
            },
            ticks: {
              padding: 5,
              font: { size: 12 }
            }
          }
        }
      }
    });
  } catch (err) {
    console.error("❌ Failed to load frozen measure data:", err);
    alert("Error loading frozen table.");
  }
}

// Save the Measure table data currently displayed (not used for frozen view)
async function saveMeasureData(projectId) {
  const table = document.getElementById("measure-table-container");
  if (!table || table.innerHTML.trim() === "") {
    console.warn("⏭️ No Measure data to save.");
    return Promise.resolve(); // Nothing to save
  }

  const rows = table.querySelectorAll("tbody tr");
  const kpis = [];
  const values = {};
  const headerCells = table.querySelectorAll("thead th");
  const machines = [...headerCells].slice(1).map(th => th.textContent.trim());

  rows.forEach(row => {
    const cells = row.querySelectorAll("td");
    const kpiName = cells[0].textContent.trim();
    kpis.push(kpiName);
    values[kpiName] = {};

    machines.forEach((machine, i) => {
      const raw = cells[i + 1]?.textContent.trim();
      const parsed = parseFloat(raw);
      values[kpiName][machine] = isNaN(parsed) ? null : parsed;
    });
  });

  // Estimate the range if possible
  const rangeRadio = document.querySelector('input[name="range"]:checked');
  const range = rangeRadio ? parseInt(rangeRadio.value) : 30;

 
}

// Freeze a snapshot of Measure data (KPI, machine, date, value) for this project
async function freezeTableData(projectId) {
  const table = document.getElementById("measure-table-container");
  const rows = table.querySelectorAll("tbody tr");

  if (!rows.length) {
    alert("No table data to save.");
    return;
  }

  const selectedKpi = document.getElementById("measure-kpi-select").value;
  const range = parseInt(document.querySelector('input[name="range"]:checked').value);

  const data = Array.from(rows)
  .map(row => {
    const cells = row.querySelectorAll("td");
    const rawDate = cells[2].getAttribute("data-raw");
    const value = parseFloat(cells[3].innerText);
    return rawDate ? {
      kpi: selectedKpi,
      machine: cells[1].innerText,
      date: rawDate,
      value
    } : null;
  })
  .filter(row => row !== null);
  if (data.length === 0) {
    console.warn("⏭️ No valid rows to freeze – skipping insert.");
    const btn = document.querySelector(`button[onclick*="freezeTableData"]`);
    if (btn) showSuccessCheckmark(btn);
    return;
  }

  const payload = {
    projectId,
    kpi: selectedKpi,
    range,
    rows: data
  };

  try {
    const res = await fetch("/api/freeze-measure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  
    // If the request failed, do nothing visible
    if (!res.ok) return;
  
    // Show checkmark next to the save button
    const btn = document.querySelector(`button[onclick*="freezeTableData"]`);
    if (btn) showSuccessCheckmark(btn);
  
  } catch (err) {
    console.warn("❌ Freeze failed silently:", err);
  }
  
}
//END OF MEASURE//

// ANALYZE//
// Render the Analyze phase UI, including statistic sections, trend chart, and log search
function renderAnalyzePhase(project) {
  const selectedMachine = window.selectedMachine || "PC1";
  const machines = ["PC1", "PC2", "PC4", "PC5", "PC6", "PC7", "PC8", "PC9"];
  const machineOptions = machines.map(m => 
    `<option value="${m}" ${m === selectedMachine ? "selected" : ""}>${m}</option>`
  ).join('');

  return `
    <div class="card mb-3">
      <div class="card-header d-flex justify-content-between align-items-center"
           onclick="togglePhase('Analyze')"
           style="cursor: pointer;"
           data-phase="Analyze">
        <span class="fw-bold">Analyze</span>
        <button class="btn btn-sm btn-outline-secondary"
                onclick="event.stopPropagation(); loadAnalyzeData(${project.id})">
          Load Saved Analyze Data
        </button>
      </div>

      <div id="phase-content-Analyze" class="card-body py-3 px-4">
        <div class="text-end mb-3">
          <button class="btn btn-warning" onclick="startAnalyzeComputation(${project.id})">
            Start Analysis of Measured Data
          </button>
        </div>

        <div class="row">
          <div class="col-md-4">
            <h6>Statistics</h6>
            <div id="analyze-stats" class="mb-3"></div>
          </div>
          <div class="col-md-8">
            <h6>KPI Trend</h6>
            <canvas id="analyze-boxplot" height="300" style="width: 100%;"></canvas>
          </div>
        </div>

        <hr class="my-4">

        <div class="row">
          <div class="col-md-6">
            <h6>Search Maintenance Logs</h6>
            <input type="date" id="maint-start" class="form-control form-control-sm mb-2">
            <input type="date" id="maint-end" class="form-control form-control-sm mb-2">
            <input type="text" class="form-control form-control-sm mb-2" value="${selectedMachine}" disabled>
            <button class="btn btn-sm btn-outline-primary" onclick="searchMaintenanceLogs()">Search</button>
            <div id="maintenance-results" class="scroll-box mt-2 small text-muted border rounded bg-white p-2"></div>
            <div id="maintenance-pareto-zone" class="mt-3"></div>
          </div>

          <div class="col-md-6">
            <h6>Search Production Issues</h6>
            <input type="date" id="prod-start" class="form-control form-control-sm mb-2">
            <input type="date" id="prod-end" class="form-control form-control-sm mb-2">
            <input type="text" class="form-control form-control-sm mb-2" value="${selectedMachine}" disabled>
            <button class="btn btn-sm btn-outline-primary" onclick="searchProductionIssues()">Search</button>
            <div id="production-results" class="scroll-box mt-2 small text-muted border rounded bg-white p-2"></div>
            <div id="production-pareto-zone" class="mt-3"></div>
          </div>
        </div>

        <hr class="my-4">
        <div class="text-end">
          <button class="btn btn-success" onclick="saveAnalyzeData(${project.id})">
            Save Analyze Data
          </button>
        </div>
      </div>
    </div>
  `;
}

// Compute statistics and generate a KPI trend chart for a selected machine after measure phase
async function startAnalyzeComputation(projectId) {
  const btn = document.querySelector('button[onclick*="startAnalyzeComputation"]');
  showLoading(btn, "Analyzing...");

  try {
    const res = await fetch(`/api/frozen-measure/${projectId}`);
    const result = await res.json();

    const kpi = Object.keys(result.data)[0];
    const selectedMachine = window.selectedMachine || "PC1";
    const rows = result.data[kpi].filter(r => r.machine === selectedMachine);
    if (rows.length === 0) {
      alert("No data found for this machine.");
      return;
    }

    const values = rows.map(r => r.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stddev = Math.sqrt(variance);
    const median = values.length % 2 === 0
      ? (sorted[values.length / 2 - 1] + sorted[values.length / 2]) / 2
      : sorted[Math.floor(values.length / 2)];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const cv = mean !== 0 ? stddev / mean : 0;
    const unit = kpi.includes('%') ? '%' : kpi.includes('(h)') ? 'h' : '';

    document.getElementById("analyze-stats").innerHTML = `
    <ul class="list-group list-group-sm small">
      <li class="list-group-item px-2 py-1"><strong>Count:</strong> ${values.length}</li>
      <li class="list-group-item px-2 py-1"><strong>Mean:</strong> ${mean.toFixed(1)}${unit}</li>
      <li class="list-group-item px-2 py-1"><strong>Median:</strong> ${median.toFixed(1)}${unit}</li>
      <li class="list-group-item px-2 py-1"><strong>Min:</strong> ${min.toFixed(1)}${unit}</li>
      <li class="list-group-item px-2 py-1"><strong>Max:</strong> ${max.toFixed(1)}${unit}</li>
      <li class="list-group-item px-2 py-1"><strong>Variance:</strong> ${variance.toFixed(1)}</li>
      <li class="list-group-item px-2 py-1"><strong>Std Dev:</strong> ${stddev.toFixed(1)}${unit}</li>
      <li class="list-group-item px-2 py-1"><strong>Range:</strong> ${range.toFixed(1)}${unit}</li>
      <li class="list-group-item px-2 py-1"><strong>CV:</strong> ${(cv * 100).toFixed(1)}%</li>
    </ul>
  `;
  

    let canvas = document.getElementById("analyze-boxplot");

    if (!canvas || canvas.tagName.toLowerCase() !== 'canvas') {
      const parent = document.querySelector(".col-md-8");
      const newCanvas = document.createElement("canvas");
      newCanvas.id = "analyze-boxplot";

      // ✅ Définir taille HTML du canvas (résolution)
      newCanvas.setAttribute("width", "800");
      newCanvas.setAttribute("height", "300");

      // ✅ Définir taille CSS
      newCanvas.style.width = "100%";
      newCanvas.style.height = "300px";
      newCanvas.style.display = "block";

      if (canvas) canvas.replaceWith(newCanvas);
      else parent.appendChild(newCanvas);

      canvas = newCanvas;
    }

    // ✅ Enforcer les dimensions même si le canvas existait déjà
    canvas.setAttribute("width", "800");
    canvas.setAttribute("height", "300");
    canvas.style.width = "100%";
    canvas.style.height = "300px";
    canvas.style.display = "block";

    const existingChart = Chart.getChart(canvas);
    if (existingChart) existingChart.destroy();

    const ctx = canvas.getContext("2d");

    const outliers = rows
      .filter(r => r.value < mean)
      .sort((a, b) => a.value - b.value)
      .slice(0, 10);

    new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: `KPI trend – ${kpi}`,
            data: rows.map(r => ({
              x: new Date(r.date).toLocaleDateString("en-US", { month: 'short', day: 'numeric' }),
              y: r.value
            })),
            borderColor: '#007bff',
            tension: 0.3
          },
         ]
      },
      options: {
        responsive: true,
        plugins: {
          title: {
            display: true,
            text: `${kpi} Trend – ${selectedMachine}`,
            font: { size: 14 }
          }
        },
        scales: {
          x: {
            type: 'category',
            title: { display: true, text: 'Date' }
          },
          y: {
            title: { display: true, text: 'Value' }
          }
        }
      }
    });

  } catch (err) {
    console.error("❌ Failed to compute analysis:", err);
    alert("Error during analysis.");
  } finally {
    hideLoading(btn);
  }
}

// Save Analyze phase results, including statistics, logs, and charts (meta + images)
async function saveAnalyzeData(projectId) {
    try {
    // Part 1 – Text + logs
    const meta = {
      statsHTML: document.getElementById("analyze-stats")?.innerHTML || '',
      logsMaintenance: document.getElementById("maintenance-results")?.innerHTML || '',
      logsProduction: document.getElementById("production-results")?.innerHTML || ''
    };

    await fetch(`/api/analyze/meta/${projectId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meta)
    });

    // Part 2 – 3 Graphs as images
    const getSafeJPEG = (id) => {
      const canvas = document.getElementById(id);
      return canvas ? getCanvasAsJPEG(canvas) : null;
    };
    
    const images = {
      imgTrend: getSafeJPEG("analyze-boxplot"),
      imgParetoMaint: getSafeJPEG("paretoChart"),
      imgParetoProd: getSafeJPEG("paretoChartProd")
    };
    

    await fetch(`/api/analyze/images/${projectId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(images)
    });

    const btn = document.querySelector(`button[onclick*="saveAnalyzeData"]`);
    if (btn) showSuccessCheckmark(btn);
  } catch (err) {
    console.error("❌ Error saving analysis:", err);
    alert("Failed to save analysis.");
  }
}

// Load previously saved analysis data, including graphs and HTML blocks
async function loadAnalyzeData(projectId) {
  try {
    const res = await fetch(`/api/analyze/${projectId}`);
    const data = await res.json();

    if (!data || !data.stats_html) {
      return alert("No saved Analyze data found.");
    }

    // === Inject saved statistics and logs
    document.getElementById("analyze-stats").innerHTML = data.stats_html || '';
    document.getElementById("maintenance-results").innerHTML = data.logs_maintenance || '';
    document.getElementById("production-results").innerHTML = data.logs_production || '';

    const replaceCanvasWithImage = (canvasId, imgPath) => {
      if (!imgPath) return;
      const canvas = document.getElementById(canvasId);
      if (canvas) {
        const img = new Image();
        img.src = imgPath;
        img.className = canvas.className || 'img-fluid mt-2';
        canvas.replaceWith(img);
      }
    };

    // === KPI Trend Chart
    if (data.img_trend_path) {
      replaceCanvasWithImage("analyze-boxplot", data.img_trend_path);
    } else {
      await startAnalyzeComputation(projectId);
      return;
    }

    // === Maintenance Pareto
    const maintenanceZone = document.getElementById("maintenance-pareto-zone");
    maintenanceZone.innerHTML = `
      <div class="mt-3 text-end">
        <button class="btn btn-sm btn-danger" onclick="generatePareto()">Generate Pareto</button>
        <div class="mt-3"><canvas id="paretoChart" height="300"></canvas></div>
      </div>
    `;

    setTimeout(() => {
      if (data.img_pareto_maint_path) {
        replaceCanvasWithImage("paretoChart", data.img_pareto_maint_path);
      } else if (document.querySelector("#maintenance-results .border")) {
        generatePareto();
      }
    }, 100);

    // === Production Pareto
    const productionZone = document.getElementById("production-pareto-zone");
    productionZone.innerHTML = `
      <div class="mt-3 text-end">
        <button class="btn btn-sm btn-danger" onclick="generateProdPareto()">Generate Pareto</button>
        <div class="mt-3"><canvas id="paretoChartProd" height="300"></canvas></div>
      </div>
    `;

    setTimeout(() => {
      if (data.img_pareto_prod_path) {
        replaceCanvasWithImage("paretoChartProd", data.img_pareto_prod_path);
      } else if (document.querySelector("#production-results .border")) {
        generateProdPareto();
      }
    }, 100);

  } catch (err) {
    console.error("❌ Failed to load Analyze data:", err);
    alert("Server error loading Analyze data.");
  }
}

// Format a single statistical result into an HTML list item
function formatStat(label, value, unit = '') {
  const suffix = unit ? ` ${unit}` : '';
  return `<li class="list-group-item px-2 py-1"><strong>${label}:</strong> ${value}${suffix}</li>`;
}

// Search backend for maintenance logs within a selected date range for a machine
async function searchMaintenanceLogs() {
  const startDate = document.getElementById("maint-start").value;
  const endDate = document.getElementById("maint-end").value;
  const plyCutter = document.getElementById("measure-kpi-select")?.dataset.selectedMachine || "PC1";

  if (!startDate || !endDate || !plyCutter) {
    alert("Please select a start date, end date and machine.");
    return;
  }

  try {
    const res = await fetch(`/api/maintenance/logs?start=${startDate}&end=${endDate}&plyCutter=${plyCutter}`);
    const result = await res.json();

    const logs = result?.logs ?? [];

    if (!logs.length) {
      document.getElementById("maintenance-results").innerHTML = `<em>No logs found.</em>`;
      return;
    }

    const html = logs.map(log => `
      <div class="border rounded p-2 mb-2 bg-light small">
        <strong>${formatAustinDate(log.start_time)}</strong><br>
        Reason: <em>${log.reason || "—"}</em><br>
        Duration: ${log.duration != null && !isNaN(log.duration) ? parseFloat(log.duration).toFixed(1) : "—"} h<br>
        Work Order: ${log.work_order || "—"}<br>
        Comment: ${log.comment || "—"}
      </div>
    `).join('');

    document.getElementById("maintenance-results").innerHTML = html;
    document.getElementById("maintenance-pareto-zone").innerHTML = `
      <div class="mt-3 text-end">
        <button class="btn btn-sm btn-danger" onclick="generatePareto()">Generate Pareto</button>
        <div class="mt-3">
          <canvas id="paretoChart" height="300"></canvas>
        </div>
      </div>
    `;

    
  
  } catch (err) {
    console.error("❌ Failed to fetch maintenance logs:", err);
    alert("Server error while retrieving logs.");
  }
}

// Search backend for production issues (with shift) within a selected date range for a machine
async function searchProductionIssues() {
  const startInput = document.getElementById("prod-start").value;
  const endInput = document.getElementById("prod-end").value;
  const plyCutter = document.getElementById("measure-kpi-select")?.dataset.selectedMachine || "PC1";

  if (!startInput || !endInput || !plyCutter) {
    alert("Please select start date, end date and machine.");
    return;
  }

  const startDate = new Date(startInput);
  const endDate = new Date(endInput);
  endDate.setHours(23, 59, 59, 999); // Include the full last day

  const results = [];

  // Generate each day in range
  for (let current = new Date(startDate); current <= endDate; current.setDate(current.getDate() + 1)) {
    const dayStr = current.toISOString().slice(0, 10);

    for (let shift = 1; shift <= 3; shift++) {
      try {
        const res = await fetch(`/api/get-issues?plyCutter=${plyCutter}&day=${dayStr}&shift=${shift}`);
        const data = await res.json();

        if (Array.isArray(data.issues) && data.issues.length > 0) {
          data.issues.forEach(issue => {
            results.push({
              date: dayStr,
              shift,
              ...issue
            });
          });
        }
      } catch (err) {
        console.warn(`⚠️ Failed to fetch issues for ${dayStr} shift ${shift}:`, err);
      }
    }
  }

  const outputContainer = document.getElementById("production-results");

  if (results.length === 0) {
    outputContainer.innerHTML = `<em>No production issues found.</em>`;
    document.getElementById("production-pareto-zone").innerHTML = "";
    return;
  }

  // Sort descending by date then shift
  results.sort((a, b) => {
    const d1 = new Date(`${b.date}T00:00:00`) - new Date(`${a.date}T00:00:00`);
    return d1 !== 0 ? d1 : b.shift - a.shift;
  });

  const html = results.map(r => `
    <div class="border rounded p-2 mb-2 bg-light small">
      <strong>${new Date(r.date + 'T12:00:00').toLocaleDateString("en-US", {
        timeZone: "America/Chicago",
        month: 'short',
        day: 'numeric'
      })} — Shift ${r.shift}</strong><br>
      Type: <em>${r.issue_type}</em><br>
      Downtime: ${r.downtime || "—"} min<br>
      Comment: ${r.comment || "—"}
    </div>
  `).join('');

  outputContainer.innerHTML = html;

  // Add Generate Pareto button below scroll container
  document.getElementById("production-pareto-zone").innerHTML = `
    <div class="mt-3 text-end">
      <button class="btn btn-sm btn-danger" onclick="generateProdPareto()">Generate Pareto</button>
      <div class="mt-3"><canvas id="paretoChartProd" height="300"></canvas></div>
    </div>
  `;
}

// Generate and render the maintenance Pareto chart from maintenance logs
function generatePareto() {
  const cards = [...document.querySelectorAll("#maintenance-results .border")];

  const issues = cards.map(card => {
    const reasonMatch = card.innerHTML.match(/Reason: <em>(.*?)<\/em>/);
    const durationMatch = card.innerHTML.match(/Duration: ([\d.]+) h/);
    return {
      reason: reasonMatch ? reasonMatch[1] : "Unknown",
      duration: durationMatch ? parseFloat(durationMatch[1]) : 0
    };
  });

  const grouped = {};
  for (const issue of issues) {
    if (!grouped[issue.reason]) grouped[issue.reason] = 0;
    grouped[issue.reason] += issue.duration;
  }

  const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [_, val]) => sum + val, 0);
  let cum = 0;

  const labels = [];
  const bars = [];
  const lines = [];

  for (const [reason, val] of sorted) {
    cum += val;
    labels.push(reason.length > 20 ? reason.slice(0, 17) + "…" : reason);
    bars.push(val);
    lines.push((cum / total * 100).toFixed(1));
  }

  const container = document.getElementById("maintenance-pareto-zone");
  container.innerHTML = `
    <div class="mt-3 text-end">
      <button class="btn btn-sm btn-danger" onclick="generatePareto()">Generate Pareto</button>
      <div class="mt-3"><canvas id="paretoChart" height="300"></canvas></div>
    </div>
  `;
  Chart.getChart("paretoChart")?.destroy();
  new Chart(document.getElementById("paretoChart"), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: "Total Downtime (h)",
          data: bars,
          backgroundColor: "rgba(255, 99, 132, 0.5)",
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: "Cumulative %",
          data: lines,
          borderColor: "red",
          yAxisID: 'y1',
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: "Pareto Chart of Maintenance Reasons" }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Downtime (h)' }
        },
        y1: {
          beginAtZero: true,
          max: 100,
          position: 'right',
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'Cumulative %' }
        }
      }
    }
  });
}

// Generate and render the production Pareto chart from production issue records
function generateProdPareto() {
  const cards = [...document.querySelectorAll("#production-results .border")];

  const issues = cards.map(card => {
    const typeMatch = card.innerHTML.match(/Type: <em>(.*?)<\/em>/);
    const downtimeMatch = card.innerHTML.match(/Downtime: ([\d.]+) min/);
    return {
      type: typeMatch ? typeMatch[1] : "Unknown",
      downtime: downtimeMatch ? parseFloat(downtimeMatch[1]) : 0
    };
  });

  const grouped = {};
  for (const issue of issues) {
    if (!grouped[issue.type]) grouped[issue.type] = 0;
    grouped[issue.type] += issue.downtime;
  }

  const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [_, val]) => sum + val, 0);
  let cum = 0;

  const labels = [];
  const bars = [];
  const lines = [];

  for (const [type, val] of sorted) {
    cum += val;
    labels.push(type.length > 20 ? type.slice(0, 17) + "…" : type);
    bars.push(val);
    lines.push((cum / total * 100).toFixed(1));
  }

  const container = document.getElementById("production-pareto-zone");
  container.innerHTML = `
    <div class="mt-3 text-end">
      <button class="btn btn-sm btn-danger" onclick="generateProdPareto()">Generate Pareto</button>
      <div class="mt-3"><canvas id="paretoChartProd" height="300"></canvas></div>
    </div>
  `;
  Chart.getChart("paretoChartProd")?.destroy();
  new Chart(document.getElementById("paretoChartProd"), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: "Downtime (min)",
          data: bars,
          backgroundColor: "rgba(54, 162, 235, 0.6)",
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: "Cumulative %",
          data: lines,
          borderColor: "orange",
          yAxisID: 'y1',
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: "Pareto Chart of Production Issues" }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Downtime (min)' }
        },
        y1: {
          beginAtZero: true,
          max: 100,
          position: 'right',
          grid: { drawOnChartArea: false },
          title: { display: true, text: 'Cumulative %' }
        }
      }
    }
  });
}

//END OF ANALYZE


//IMPROVE//
// Render the Improve phase UI with fields for defining and analyzing improvements
function renderImprovePhase(project) {
  const selectedKpi = document.getElementById("measure-kpi-select")?.value || "—";

  return `
    <div class="card mb-3">
      <div class="card-header d-flex justify-content-between align-items-center"
           onclick="togglePhase('Improve')"
           style="cursor: pointer;"
           data-phase="Improve">
        <span class="fw-bold">Improve</span>
        <button class="btn btn-sm btn-outline-secondary"
                onclick="event.stopPropagation(); loadSavedImproveData(${project.id})">
          Load Saved Improve Data
        </button>

      </div>

      <div id="phase-content-Improve" class="card-body py-3 px-4">
        <form id="improve-form">
          <div class="mb-3">
            <label class="form-label small">Improvement Name</label>
            <input type="text" class="form-control form-control-sm" id="improve-name" placeholder="e.g. Replace blade more frequently">
          </div>

          <div class="mb-3">
            <label class="form-label small">Description</label>
            <textarea class="form-control form-control-sm" id="improve-desc" rows="2" placeholder="Explain the proposed change..."></textarea>
          </div>

          <div class="row mb-3">
            <div class="col-md-2">
              <label class="form-label small">Effective Date</label>
              <input type="date" class="form-control form-control-sm" id="improve-date">
            </div>

            <div class="col-md-2">
              <label class="form-label small">Status</label>
              <select class="form-select form-select-sm" id="improve-status">
                <option value="Proposed">Proposed</option>
                <option value="Testing">Testing</option>
                <option value="Implemented">Implemented</option>
                <option value="Abandoned">Abandoned</option>
              </select>
            </div>

            <div class="col-md-3">
              <label class="form-label small">Target KPI</label>
              <input type="text" class="form-control form-control-sm" value="${selectedKpi}" readonly>
            </div>

            <div class="col-md-5">
              <label class="form-label small">Estimated Impact</label>
              <input type="text" class="form-control form-control-sm" id="improve-impact" placeholder="e.g. +15% OEE">
            </div>
          </div>

          <div class="text-end">
            <button class="btn btn-success" type="button" onclick="saveImproveData(${project.id})">
              Save improvement
            </button>
          </div>
        </form>

        <hr class="my-4">
        <div class="text-end mb-3">
          <button class="btn btn-warning" onclick="generateImproveAnalysis(${project.id})">
            Generate analysis
          </button>
        </div>

        <div id="improve-analysis-zone" style="display:none;">
          <div class="row">
            <div class="col-md-6">
              <h6>Recent KPI Data</h6>
              <div id="improve-data-list" class="scroll-box small border rounded p-2 bg-light"></div>
            </div>
            <div class="col-md-6">
              <h6>Histogram + Gaussian</h6>
              <canvas id="improve-histogram" height="200"></canvas>
            </div>
          </div>

          <div class="row mt-4">
            <div class="col-md-6">
              <h6>Statistics</h6>
              <ul id="improve-stats" class="list-group list-group-sm small"></ul>
            </div>
            <div class="col-md-6">
              <h6>KPI Trend</h6>
              <canvas id="improve-linechart" height="200"></canvas>
            </div>
          </div>

          <div class="row mt-4">
            <div class="col-md-6">
              <h6>Maintenance Pareto</h6>
              <div id="improve-maint-log" class="scroll-box small text-muted border rounded bg-white p-2 mb-3"></div>
              <canvas id="improve-pareto-maint" height="250"></canvas>
            </div>
            <div class="col-md-6">
              <h6>Production Pareto</h6>
              <div id="improve-prod-log" class="scroll-box small text-muted border rounded bg-white p-2 mb-3"></div>
              <canvas id="improve-pareto-prod" height="250"></canvas>
            </div>
          </div>

          <hr class="my-4">
          <div class="text-end mb-3">
            <button class="btn btn-outline-dark" onclick="revealImproveComparison(${project.id})">
              Reveal Results
            </button>
          </div>

          <div id="improve-comparison-zone" style="display:none;">
            <div class="row mb-4">
              <div class="col">
                <h6>Before vs After – Statistical Summary</h6>
                <div id="compare-stats"></div>
              </div>
            </div>
            <div class="row">
              <div class="col-md-6">
                <h6>Histogram Comparison</h6>
                <canvas id="compare-histogram" height="220"></canvas>
              </div>
              <div class="col-md-6">
                <h6>KPI Trend Comparison</h6>
                <canvas id="compare-trend" height="220"></canvas>
              </div>
            </div>

            <div class="text-end mb-3">
              <button class="btn btn-outline-success" onclick="saveImproveResults(${project.id})">
                Save final results
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  `;
}

// Save the form fields (name, description, status, impact) from the Improve phase
function saveImproveData(projectId) {
  const payload = {
    name: document.getElementById("improve-name")?.value || '',
    description: document.getElementById("improve-desc")?.value || '',
    effective_date: document.getElementById("improve-date")?.value || null,
    status: document.getElementById("improve-status")?.value || 'Proposed',
    estimated_impact: document.getElementById("improve-impact")?.value || '',
    target_kpi: document.getElementById("measure-kpi-select")?.value || '—'
  };

  fetch(`/api/improve/${projectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        const btn = document.querySelector(`button[onclick*="saveImproveData"]`);
        if (btn) showSuccessCheckmark(btn);
      } else {
        alert("❌ Failed to save improvement data.");
      }
    })
    .catch(err => {
      console.error("Error saving improve:", err);
      alert("❌ Server error while saving.");
    });
}

// Load the previously saved Improve phase content for a given project (part 1)
function loadImproveData(projectId) {
  fetch(`/api/improve/${projectId}`)
    .then(res => res.json())
    .then(data => {
      if (!data) return;

      document.getElementById("improve-name").value = data.name || '';
      document.getElementById("improve-desc").value = data.description || '';
      document.getElementById("improve-date").value = data.effective_date?.slice(0, 10) || '';
      document.getElementById("improve-status").value = data.status || 'Proposed';
      document.getElementById("improve-impact").value = data.estimated_impact || '';
    })
    .catch(err => {
      console.error("Failed to load improvement data:", err);
    });
}

// Perform statistical comparison of KPI values before and after improvement start date
async function generateImproveAnalysis(projectId) {
  const btn = document.querySelector('button[onclick*="generateImproveAnalysis"]');
  showLoading(btn, "Analyzing...");

  try {
    const zone = document.getElementById("improve-analysis-zone");
    const kpi = document.getElementById("measure-kpi-select")?.value;
    const date = document.getElementById("improve-date")?.value;

    if (!kpi || !date) {
      alert("Missing KPI or effective date.");
      return;
    }

    const machinesRes = await fetch(`/api/projects/${projectId}/machines`);
    const machines = await machinesRes.json();
    const machine = machines[0] || "PC1";

    await loadProductionData();
    const kpiData = dataByKpi[kpi];
    if (!kpiData || !kpiData.machines?.[machine]) {
      alert("No data available for this KPI and machine.");
      return;
    }

    const labels = kpiData.labels;
    const values = kpiData.machines[machine];

    const refDate = date;  // déjà sous format YYYY-MM-DD

    const refTime = new Date(refDate + "T00:00:00-05:00").getTime(); // Austin local start of day

    const filtered = labels.map((label, i) => ({
      date: label,
      value: parseFloat(values[i])
    })).filter(d => {
      const localTime = new Date(d.date).toLocaleString("en-US", { timeZone: "America/Chicago" });
      const localDateTime = new Date(localTime).getTime();
      return localDateTime >= refTime;
    });
    
    
    
    if (filtered.length === 0) {
      alert("No data found after the effective date.");
      return;
    }

    zone.style.display = "block";

    const rows = filtered.map(d => `
      <tr>
        <td class="text-start">${kpi}</td>
        <td>${machine}</td>
        <td data-raw="${d.date}">${formatAustinDate(d.date)}</td>
        <td>${d.value.toFixed(2)}</td>
      </tr>
    `).join("");

    document.getElementById("improve-data-list").innerHTML = `
      <table class="table table-bordered text-center align-middle">
        <thead class="table-light">
          <tr><th>KPI</th><th>Machine</th><th>Date</th><th>Value</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    const vals = filtered.map(d => d.value);
    const count = vals.length;
    const mean = vals.reduce((a, b) => a + b, 0) / count;
    const sorted = [...vals].sort((a, b) => a - b);
    const median = count % 2 === 0
      ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
      : sorted[Math.floor(count / 2)];
    const stddev = Math.sqrt(vals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / count);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min;
    const cv = mean !== 0 ? stddev / mean : 0;
    const unit = kpi.includes('%') ? '%' : kpi.includes('(h)') ? 'h' : '';

    document.getElementById("improve-stats").innerHTML = `
      <li class="list-group-item px-2 py-1"><strong>Count:</strong> ${count}</li>
      <li class="list-group-item px-2 py-1"><strong>Mean:</strong> ${mean.toFixed(2)}${unit}</li>
      <li class="list-group-item px-2 py-1"><strong>Median:</strong> ${median.toFixed(2)}${unit}</li>
      <li class="list-group-item px-2 py-1"><strong>Min:</strong> ${min.toFixed(2)}${unit}</li>
      <li class="list-group-item px-2 py-1"><strong>Max:</strong> ${max.toFixed(2)}${unit}</li>
      <li class="list-group-item px-2 py-1"><strong>Std Dev:</strong> ${stddev.toFixed(2)}${unit}</li>
      <li class="list-group-item px-2 py-1"><strong>Range:</strong> ${range.toFixed(2)}${unit}</li>
      <li class="list-group-item px-2 py-1"><strong>CV:</strong> ${(cv * 100).toFixed(1)}%</li>
    `;

    const binCount = 10;
    const binWidth = range / binCount;
    const bins = Array(binCount).fill(0);
    const binCenters = [];

    for (let i = 0; i < binCount; i++) {
      binCenters.push(min + i * binWidth + binWidth / 2);
    }

    vals.forEach(v => {
      const idx = Math.min(Math.floor((v - min) / binWidth), binCount - 1);
      bins[idx]++;
    });

    const histogramData = binCenters.map((x, i) => ({ x, y: bins[i] }));

    const gaussX = [], gaussY = [];
    const steps = 100;
    for (let i = 0; i <= steps; i++) {
      const x = mean - 3 * stddev + (i / steps) * 6 * stddev;
      const y = (1 / (stddev * Math.sqrt(2 * Math.PI))) *
                Math.exp(-((x - mean) ** 2) / (2 * stddev ** 2)) *
                count * binWidth;
      gaussX.push(x);
      gaussY.push(y);
    }

    const gaussianData = gaussX.map((x, i) => ({ x, y: gaussY[i] }));

    new Chart(document.getElementById("improve-histogram"), {
      type: 'scatter',
      data: {
        datasets: [
          {
            type: 'bar',
            label: 'Histogram',
            data: histogramData,
            backgroundColor: 'rgba(0,123,255,0.7)',
            borderColor: '#000',
            borderWidth: 1.2,
            order: 1
          },
          {
            type: 'line',
            label: 'Gaussian',
            data: gaussianData,
            borderColor: 'red',
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            order: 2
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: true },
          title: {
            display: true,
            text: `Distribution of ${kpi} – ${machine}`,
            font: { size: 14 }
          },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${ctx.raw.y.toFixed(1)}`
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            min: mean - 3 * stddev,
            max: mean + 3 * stddev,
            title: { display: true, text: 'KPI Value' }
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Frequency' }
          }
        }
      }
    });

    new Chart(document.getElementById("improve-linechart"), {
      type: 'line',
      data: {
        labels: filtered.map(d =>
          new Date(d.date).toLocaleDateString("en-US", { month: 'short', day: 'numeric' })
        ),
        datasets: [{
          label: `${kpi} – ${machine}`,
          data: filtered.map(d => d.value),
          borderColor: '#007bff',
          fill: false,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: true } }
      }
    });

    await generateParetoFor("maintenance", date, machine, "improve-pareto-maint", "improve-maint-log");
    await generateParetoFor("production", date, machine, "improve-pareto-prod", "improve-prod-log");

  } catch (err) {
    console.error("❌ Failed to analyze improvement:", err);
    alert("Error during improvement analysis.");
  } finally {
    hideLoading(btn);
  }
}

// Generate a Pareto chart from filtered logs using provided canvas and container IDs
async function generateParetoFor(type, startDate, plyCutter, canvasId, logContainerId) {
  const today = new Date().toISOString().slice(0, 10);
  const data = [];

  // 🔁 Récupération des données par jour
  for (let current = new Date(startDate); current <= new Date(); current.setDate(current.getDate() + 1)) {
    const dayStr = current.toISOString().slice(0, 10);

    if (type === "maintenance") {
      try {
        const res = await fetch(`/api/maintenance/logs?start=${dayStr}&end=${dayStr}&plyCutter=${plyCutter}`);
        const result = await res.json();
        if (Array.isArray(result.logs)) data.push(...result.logs);
      } catch (err) {
        console.warn(`❌ Error loading maintenance logs for ${dayStr}:`, err);
      }
    } else if (type === "production") {
      for (let shift = 1; shift <= 3; shift++) {
        try {
          const res = await fetch(`/api/get-issues?plyCutter=${plyCutter}&day=${dayStr}&shift=${shift}`);
          const result = await res.json();
          if (Array.isArray(result.issues)) {
            result.issues.forEach(issue => data.push({ ...issue, shift, date: dayStr }));
          }
        } catch (err) {
          console.warn(`❌ Error loading production issues for ${dayStr} shift ${shift}:`, err);
        }
      }
    }
  }

  // 🖼️ Affichage des logs au-dessus du graphique
  const container = document.getElementById(logContainerId);
  if (container) {
    if (type === "maintenance") {
      container.innerHTML = data.map(log => `
        <div class="border rounded p-2 mb-2 bg-light small">
          <strong>${formatAustinDate(log.start_time)}</strong><br>
          Reason: <em>${log.reason || "—"}</em><br>
          Duration: ${log.duration != null && !isNaN(log.duration) ? parseFloat(log.duration).toFixed(1) : "—"} h<br>
          Work Order: ${log.work_order || "—"}<br>
          Comment: ${log.comment || "—"}
        </div>
      `).join('');
    } else {
      container.innerHTML = data.map(issue => `
        <div class="border rounded p-2 mb-2 bg-light small">
          <strong>${new Date(issue.date + 'T12:00:00').toLocaleDateString("en-US", {
            timeZone: "America/Chicago",
            month: 'short',
            day: 'numeric'
          })} — Shift ${issue.shift}</strong><br>
          Type: <em>${issue.issue_type}</em><br>
          Downtime: ${issue.downtime != null ? parseFloat(issue.downtime).toFixed(1) : "—"} min<br>
          Comment: ${issue.comment || "—"}
        </div>
      `).join('');
    }
  }

  // 📊 Construction du graphe Pareto
  const grouped = {};
  for (const item of data) {
    const key = item.reason || item.issue_type || "Other";
    let raw = parseFloat(item.duration || item.downtime || 0);
    if (isNaN(raw)) continue;

    const value = type === "maintenance" ? raw : raw / 60; // Convert min → h for production
    grouped[key] = (grouped[key] || 0) + value;
  }

  const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, val]) => sum + val, 0);
  let cum = 0;

  const labels = [], bars = [], lines = [];
  for (const [label, val] of sorted) {
    cum += val;
    labels.push(label.length > 20 ? label.slice(0, 17) + "…" : label);
    bars.push(val);
    lines.push((cum / total * 100).toFixed(1));
  }

  new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: "Duration (h)",
          data: bars,
          backgroundColor: "rgba(255,99,132,0.5)",
          yAxisID: 'y'
        },
        {
          type: 'line',
          label: "Cumulative %",
          data: lines,
          borderColor: "red",
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: type === "maintenance"
            ? "Maintenance Downtime (in hours)"
            : "Production Issues (converted to hours)"
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: "Duration (h)" }
        },
        y1: {
          beginAtZero: true,
          max: 100,
          position: "right",
          grid: { drawOnChartArea: false },
          title: { display: true, text: "Cumulative %" }
        }
      }
    }
  });
}

// Reveal the Improve comparison chart with all pre/post data and interpretation
async function revealImproveComparison(projectId) {
  const zone = document.getElementById("improve-comparison-zone");
  zone.style.display = "block";

  const kpi = document.getElementById("measure-kpi-select")?.value;
  const effectiveDate = new Date(document.getElementById("improve-date")?.value);

  if (!kpi || !effectiveDate) {
    return alert("Missing KPI or effective date.");
  }

  const kpiData = dataByKpi[kpi];
  if (!kpiData) return alert("KPI data not found");

  const machinesRes = await fetch(`/api/projects/${projectId}/machines`);
  const machines = await machinesRes.json();
  const machine = machines[0] || "PC1";

  const labels = kpiData.labels;
  const values = kpiData.machines[machine] || [];

  const allData = labels.map((label, i) => ({
    date: new Date(label),
    raw: label,
    value: values[i]
  })).filter(d => d.value != null && !isNaN(d.value));

  const before = allData.filter(d => d.date < effectiveDate);
  const after = allData.filter(d => d.date >= effectiveDate);

  if (before.length === 0 || after.length === 0) {
    return alert("Not enough data to compare before and after improvement.");
  }

  const getStats = (dataset) => {
    const vals = dataset.map(d => parseFloat(d.value)).filter(v => !isNaN(v));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sorted = [...vals].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    const stddev = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const cv = mean ? stddev / mean : 0;
    return { count: vals.length, mean, median, stddev, min, max, cv };
  };

  const b = getStats(before);
  const a = getStats(after);
  const unit = kpi.includes('%') ? '%' : kpi.includes('(h)') ? 'h' : '';

  const diffColor = (beforeVal, afterVal, invert = false) => {
    const improved = invert ? afterVal < beforeVal : afterVal > beforeVal;
    const color = improved ? 'green' : 'red';
    return `<span style="color:${color}">${afterVal.toFixed(2)}${unit}</span>`;
  };

  document.getElementById("compare-stats").innerHTML = `
    <table class="table table-bordered text-center small">
      <thead class="table-light"><tr><th>Metric</th><th>Before</th><th>After</th></tr></thead>
      <tbody>
        <tr><td>Count</td><td>${b.count}</td><td>${a.count}</td></tr>
        <tr><td>Mean</td><td>${b.mean.toFixed(2)}${unit}</td><td>${diffColor(b.mean, a.mean)}</td></tr>
        <tr><td>Median</td><td>${b.median.toFixed(2)}${unit}</td><td>${diffColor(b.median, a.median)}</td></tr>
        <tr><td>Std Dev</td><td>${b.stddev.toFixed(2)}${unit}</td><td>${diffColor(b.stddev, a.stddev, true)}</td></tr>
        <tr><td>CV (%)</td><td>${(b.cv * 100).toFixed(1)}%</td><td>${diffColor(b.cv * 100, a.cv * 100, true)}</td></tr>
      </tbody>
    </table>
  `;

  // === HISTOGRAM + GAUSSIENNES ===
  const min = Math.min(...before.map(d => d.value), ...after.map(d => d.value));
  const max = Math.max(...before.map(d => d.value), ...after.map(d => d.value));
  const binCount = 10;
  const binWidth = (max - min) / binCount;
  const binCenters = Array.from({ length: binCount }, (_, i) => min + binWidth * (i + 0.5));

  const getHist = (dataset) => {
    const bins = Array(binCount).fill(0);
    dataset.forEach(d => {
      const i = Math.min(Math.floor((d.value - min) / binWidth), binCount - 1);
      bins[i]++;
    });
    return bins;
  };

  const getGauss = (stats) => {
    const steps = 100;
    const x = [], y = [];
    for (let i = 0; i <= steps; i++) {
      const val = stats.mean - 3 * stats.stddev + (i / steps) * 6 * stats.stddev;
      const prob = (1 / (stats.stddev * Math.sqrt(2 * Math.PI))) *
                   Math.exp(-((val - stats.mean) ** 2) / (2 * stats.stddev ** 2));
      x.push(val);
      y.push(prob * stats.count * binWidth);
    }
    return x.map((xi, i) => ({ x: xi, y: y[i] }));
  };

  new Chart(document.getElementById("compare-histogram"), {
    type: 'scatter',
    data: {
      datasets: [
        {
          type: 'bar',
          label: 'Before',
          data: binCenters.map((x, i) => ({ x, y: getHist(before)[i] })),
          backgroundColor: 'rgba(0, 123, 255, 0.5)',
          borderColor: 'blue',
          borderWidth: 1,
          order: 1
        },
        {
          type: 'bar',
          label: 'After',
          data: binCenters.map((x, i) => ({ x, y: getHist(after)[i] })),
          backgroundColor: 'rgba(40, 167, 69, 0.5)',
          borderColor: 'green',
          borderWidth: 1,
          order: 2
        },
        {
          type: 'line',
          label: 'Gaussian (Before)',
          data: getGauss(b),
          borderColor: 'blue',
          borderWidth: 2,
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          order: 3
        },
        {
          type: 'line',
          label: 'Gaussian (After)',
          data: getGauss(a),
          borderColor: 'green',
          borderWidth: 2,
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          order: 4
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: `Histogram Comparison – ${kpi} – ${machine}`,
          font: { size: 14 }
        },
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.raw.y.toFixed(2)}`
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          min: min - binWidth,
          max: max + binWidth,
          title: { display: true, text: 'KPI Value' }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Frequency' }
        }
      }
    }
  });
  

  // === TREND
  const fullLabels = allData.map(d => d.raw);
  const beforePoints = before.map(d => d.value);
  const afterPoints = after.map(d => d.value);

  const dateLineIndex = before.length - 1;
  const bgPlugin = {
    id: 'verticalLine',
    beforeDraw(chart) {
      const ctx = chart.ctx;
      const xAxis = chart.scales.x;
      const index = dateLineIndex;
      if (!xAxis || index === -1) return;
      const x = xAxis.getPixelForValue(index);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, chart.chartArea.top);
      ctx.lineTo(x, chart.chartArea.bottom);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'gray';
      ctx.stroke();
      ctx.restore();
    }
  };

  new Chart(document.getElementById("compare-trend"), {
    type: 'line',
    data: {
      labels: fullLabels,
      datasets: [
        {
          label: 'Before',
          data: [...beforePoints, ...Array(afterPoints.length).fill(null)],
          borderColor: 'blue',
          tension: 0.3
        },
        {
          label: 'After',
          data: [...Array(beforePoints.length).fill(null), ...afterPoints],
          borderColor: 'green',
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top' },
        title: {
          display: true,
          text: `KPI Trend Comparison – ${kpi} – ${machine}`,
          font: { size: 14 }
        }
      }
    },
    plugins: [bgPlugin]
  });
  
}

// Convert a canvas element to JPEG format for saving charts to backend
function getCanvasAsJPEG(canvas, quality = 0.65) {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  const ctx = tempCanvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
  ctx.drawImage(canvas, 0, 0);

  return tempCanvas.toDataURL("image/jpeg", quality);
}

// Save Improve phase charts and results using multiple payloads for size optimization
async function saveImproveResults(projectId) {
  try {
    // === PART 1: Text and HTML ===
    const payloadMeta = {
      name: document.getElementById("improve-name")?.value || '',
      description: document.getElementById("improve-desc")?.value || '',
      effective_date: document.getElementById("improve-date")?.value || '',
      status: document.getElementById("improve-status")?.value || 'Proposed',
      estimated_impact: document.getElementById("improve-impact")?.value || '',
      target_kpi: document.getElementById("measure-kpi-select")?.value || '—',
      table_html: document.getElementById("improve-data-list")?.innerHTML || '',
      stats_html: document.getElementById("improve-stats")?.innerHTML || '',
      comparison_html: document.getElementById("compare-stats")?.innerHTML || ''
    };

    await fetch(`/api/improve/full/meta/${projectId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadMeta)
    });

    // === PART 2: Main Graphs (4)
    const mainGraphIds = {
      "improve-histogram": "img_histogram",
      "improve-linechart": "img_trend",
      "compare-histogram": "img_compare_hist",
      "compare-trend": "img_compare_trend"
    };

    const graphImages = {};
    Object.entries(mainGraphIds).forEach(([id, key]) => {
      const canvas = document.getElementById(id);
      if (canvas) {
        graphImages[key] = getCanvasAsJPEG(canvas);
      }
    });

    await fetch(`/api/improve/full/graphs/${projectId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(graphImages)
    });

    // === PART 3: Pareto Graphs (2)
    const paretoImages = {};
    const paretoIds = {
      "improve-pareto-maint": "img_pareto_maint",
      "improve-pareto-prod": "img_pareto_prod"
    };

    Object.entries(paretoIds).forEach(([id, key]) => {
      const canvas = document.getElementById(id);
      if (canvas) {
        paretoImages[key] = getCanvasAsJPEG(canvas);
      }
    });

    await fetch(`/api/improve/full/paretos/${projectId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(paretoImages)
    });

    const btn = document.querySelector(`button[onclick*="saveImproveResults"]`);
    if (btn) showSuccessCheckmark(btn);
  } catch (err) {
    console.error("❌ Error saving improve data:", err);
    alert("Failed to save Improve data.");
  }
}

// Load the full Improve phase (part 1 and part 2) from backend for editing or viewing
async function loadSavedImproveData(projectId) {
  try {
    const res = await fetch(`/api/improve/full/${projectId}`);
    const data = await res.json();

    if (!data || !data.name) {
      return alert("No saved Improve data found.");
    }

    // === Recharger les champs du formulaire Improve
    document.getElementById("improve-name").value = data.name || '';
    document.getElementById("improve-desc").value = data.description || '';
    document.getElementById("improve-date").value = data.effective_date?.slice(0, 10) || '';
    document.getElementById("improve-status").value = data.status || 'Proposed';
    document.getElementById("improve-impact").value = data.estimated_impact || '';

    // === Recharger l’analyse
    const zone = document.getElementById("improve-analysis-zone");
    zone.style.display = "block";
    document.getElementById("improve-data-list").innerHTML = data.table_html || '';
    document.getElementById("improve-stats").innerHTML = data.stats_html || '';

    const replaceCanvasWithImage = (canvasId, path) => {
      if (!path) return;
      const canvas = document.getElementById(canvasId);
      if (canvas) {
        const img = new Image();
        img.src = path;
        img.className = 'img-fluid mt-2';
        img.style.width = '100%';
        img.style.height = '250px';
        img.style.objectFit = 'contain';
        canvas.replaceWith(img);
        
      }
    };

    if (data.img_histogram_path) {
      replaceCanvasWithImage("improve-histogram", data.img_histogram_path);
    } else {
      await generateImproveAnalysis(projectId);
      return;
    }
    
    if (data.img_trend_path) {
      replaceCanvasWithImage("improve-linechart", data.img_trend_path);
    }
    

    // === Recharger la comparaison
    document.getElementById("improve-comparison-zone").style.display = "block";
    document.getElementById("compare-stats").innerHTML = data.comparison_html || '';

    replaceCanvasWithImage("compare-histogram", data.img_compare_hist_path);
    replaceCanvasWithImage("compare-trend", data.img_compare_trend_path);

    // === Recharger les paretos
    replaceCanvasWithImage("improve-pareto-maint", data.img_pareto_maint_path);
    replaceCanvasWithImage("improve-pareto-prod", data.img_pareto_prod_path);
    

  } catch (err) {
    console.error("❌ Error loading improve data:", err);
    alert("Failed to load saved improve data.");
  }
}
// END OF IMPROVE

// CONTROL
// Render the Control phase UI and status indicators for the selected project
function renderControlPhase(project) {
  return `
    <div class="card mb-3">
      <div class="card-header d-flex justify-content-between align-items-center"
           onclick="togglePhase('Control')"
           style="cursor: pointer;"
           data-phase="Control">
        <span class="fw-bold">Control</span>
        <button class="btn btn-sm btn-outline-secondary"
                onclick="event.stopPropagation(); loadControlData(${project.id})">
          Load Saved Control Data
        </button>
      </div>

      <div id="phase-content-Control" class="card-body py-3 px-4">
        <form id="control-form">
          <ul class="list-group list-group-flush mb-3">
            ${[
              "A clear and visible alert threshold is defined (value, unit, visual marker)",
              "A specific person is assigned to monitor the KPI daily (name, role)",
              "All operators affected by the improvement have been informed",
              "All operators received formal training (attendance sheet or e-learning proof)",
              "A control plan has been documented (frequency, tools, responsibilities)",
              "A post-mortem report is scheduled"
            ].map((label, i) => `
              <li class="list-group-item">
                <input class="form-check-input me-2" type="checkbox" id="control-check-${i}">
                <label class="form-check-label small" for="control-check-${i}">${label}</label>
              </li>
            `).join('')}
          </ul>

          <div class="mb-3">
            <label class="form-label small">Comments (optional)</label>
            <textarea id="control-comment" class="form-control form-control-sm" rows="3" placeholder="Optional notes..."></textarea>
          </div>

          <div class="text-end">
            <button class="btn btn-success" type="button" onclick="saveControlData(${project.id})">
              Save Control Data
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

// Save the selected control method and validation details into the backend
function saveControlData(projectId) {
  const checks = Array.from({ length: 6 }, (_, i) =>
    document.getElementById(`control-check-${i}`)?.checked || false
  );

  const comment = document.getElementById("control-comment")?.value || '';

  fetch(`/api/control/${projectId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checks, comment })
  })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        const btn = document.querySelector(`button[onclick*="saveControlData"]`);
        if (btn) showSuccessCheckmark(btn);
      } else {
        alert("❌ Failed to save control data.");
      }
    })
    .catch(err => {
      console.error("❌ Error saving control data:", err);
      alert("Server error while saving control data.");
    });
}

// Load previously saved Control phase data for display in the form
function loadControlData(projectId) {
  fetch(`/api/control/${projectId}`)
    .then(res => res.json())
    .then(data => {
      if (!data) {
        const btn = document.querySelector(`button[onclick*="loadControlData"]`);
        if (btn) showFailureCross(btn);
        return;
      }
    

      for (let i = 0; i < 6; i++) {
        document.getElementById(`control-check-${i}`).checked = !!data[`check_${i}`];
      }

      document.getElementById("control-comment").value = data.comment || '';
    })
    .catch(err => {
      console.error("❌ Failed to load control data:", err);
    });
}
// END OF CONTROL

//CLOSURE SECTION
// Render the Closure phase UI for the selected project, including outcome and final notes
function renderClosePhase(project) {
  return `
    <div class="card mb-3">
      <div class="card-header d-flex justify-content-between align-items-center"
           onclick="togglePhase('Closed')"
           style="cursor: pointer;"
           data-phase="Closed">
        <span class="fw-bold">Closure</span>
        <button class="btn btn-sm btn-outline-secondary"
                onclick="event.stopPropagation(); loadCloseData(${project.id})">
          Load Saved Close Data
        </button>
      </div>

      <div id="phase-content-Closed" class="card-body py-3 px-4">
        <form id="close-form">
          <h6 class="mb-2">Project Summary (from Define)</h6>
          <div class="row mb-3">
            <div class="col-md-6">
              <label class="form-label small">Project Title</label>
              <input type="text" class="form-control form-control-sm" value="${project.title}" readonly>
            </div>
            <div class="col-md-3">
              <label class="form-label small">Start Date</label>
              <input type="date" class="form-control form-control-sm" value="${(project.start_date || '').slice(0, 10)}" readonly>
            </div>
            <div class="col-md-3">
              <label class="form-label small">Estimated End</label>
              <input type="date" class="form-control form-control-sm" value="${(project.closure_date || '').slice(0, 10)}" readonly>
            </div>
            <div class="col-md-12 mt-2">
              <label class="form-label small">Estimated Impact</label>
              <input type="text" class="form-control form-control-sm" id="close-estimated-impact" readonly>
            </div>
          </div>

          <h6 class="mb-2">Project Outcome</h6>
          <div class="mb-3">
            <div class="form-check form-check-inline">
              <input class="form-check-input" type="radio" name="project-outcome" id="outcome-success" value="success">
              <label class="form-check-label" for="outcome-success">Project Success</label>
            </div>
            <div class="form-check form-check-inline">
              <input class="form-check-input" type="radio" name="project-outcome" id="outcome-failure" value="failure">
              <label class="form-check-label" for="outcome-failure">Project Failure</label>
            </div>
          </div>


          <h6 class="mb-2">Finalization</h6>
          <div class="row mb-3">
            <div class="col-md-4">
              <label class="form-label small">Actual Closure Date</label>
              <input type="date" class="form-control form-control-sm" id="close-actual-date">
            </div>
            <div class="col-md-8">
              <label class="form-label small">Measured Impact</label>
              <input type="text" class="form-control form-control-sm" id="close-measured-impact">
            </div>
          </div>

          <div class="mb-3">
            <label class="form-label small">Final Comment / Notes</label>
            <textarea class="form-control form-control-sm" id="close-comment" rows="3" placeholder="Summarize what was achieved, remaining actions, etc."></textarea>
          </div>

          <div class="text-end">
            <button class="btn btn-success" type="button" onclick="saveCloseData(${project.id})">
              Save Closure
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}

// Save final project outcome, measured impact, and closure notes to backend
function saveCloseData(projectId) {
  const outcome = document.querySelector('input[name="project-outcome"]:checked')?.value || null;
  const payload = {
    actual_closure_date: document.getElementById("close-actual-date")?.value || null,
    measured_impact: document.getElementById("close-measured-impact")?.value || '',
    comment: document.getElementById("close-comment")?.value || '',
    outcome
  };
  

  fetch(`/api/close/${projectId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        const btn = document.querySelector(`button[onclick*="saveCloseData"]`);
        if (btn) showSuccessCheckmark(btn);
      } else {
        alert("❌ Failed to save closure.");
      } 
    })
    .catch(err => {
      console.error("❌ Error saving closure:", err);
      alert("Server error.");
    });
}

// Load previously saved closure data and estimated impact for display in the form
function loadCloseData(projectId) {
  fetch(`/api/close/${projectId}`)
    .then(res => res.json())
    .then(data => {
      if (!data) {
        const btn = document.querySelector(`button[onclick*="loadCloseData"]`);
        if (btn) showFailureCross(btn);
        return;
      }
    
      document.getElementById("close-actual-date").value = data.actual_closure_date?.slice(0, 10) || '';
      document.getElementById("close-measured-impact").value = data.measured_impact || '';
      document.getElementById("close-comment").value = data.comment || '';

      if (data.outcome === 'success') {
        document.getElementById("outcome-success").checked = true;
      } else if (data.outcome === 'failure') {
        document.getElementById("outcome-failure").checked = true;
      }
      
    })
    .catch(err => {
      console.error("❌ Error loading closure data:", err);
    });

  // Charger aussi le champ estimated impact depuis le Define
  fetch(`/api/define/${projectId}`)
    .then(res => res.json())
    .then(data => {
      if (data?.estimated_impact) {
        document.getElementById("close-estimated-impact").value = data.estimated_impact;
      }
    })
    .catch(err => {
      console.error("❌ Error loading define data:", err);
    });

}
// END OF CLOSURE FORM

// Show a confirmation dialog before permanently deleting a project and all related data
function confirmDeleteProject(projectId) {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.top = 0;
  overlay.style.left = 0;
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.background = "rgba(0, 0, 0, 0.6)";
  overlay.style.zIndex = 9999;
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";

  overlay.innerHTML = `
    <div class="bg-white rounded shadow p-4" style="max-width: 400px; width: 90%;">
      <h5 class="mb-3">Confirm Deletion</h5>
      <p class="small mb-4">Are you sure you want to permanently delete this project and all its data?</p>
      <div class="text-end">
        <button class="btn btn-secondary btn-sm me-2" onclick="this.closest('div[style]').remove()">Cancel</button>
        <button class="btn btn-danger btn-sm" onclick="deleteProject(${projectId}, this)">Delete</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

// Delete the selected project from the backend and refresh the project list
function deleteProject(projectId, btn) {
  btn.disabled = true;
  btn.textContent = "Deleting...";

  fetch(`/api/delete-project/${projectId}`, { method: "DELETE" })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        document.body.querySelector('div[style*="position: fixed"]').remove();
        loadProjects();
      } else {
        alert("❌ Failed to delete project.");
      }
    })
    .catch(err => {
      console.error("❌ Deletion error:", err);
      alert("Server error during deletion.");
    });
}

// Visually show a green checkmark next to a button to confirm successful action
function showSuccessCheckmark(btn) {
  // Avoid duplicate checkmarks
  if (btn.nextElementSibling?.classList?.contains('checkmark-confirm')) return;

  const check = document.createElement('span');
  check.innerHTML = '✔️';
  check.className = 'checkmark-confirm';
  check.style.marginLeft = '8px';
  check.style.color = 'green';
  check.style.fontSize = '1rem';

  btn.parentNode.insertBefore(check, btn.nextSibling);

  setTimeout(() => {
    check.remove();
  }, 5000);
}

// Same as above — may be duplicate and could be refactored (second declaration)
function showSuccessCheckmark(btn) {
  // Avoid duplicate checkmarks
  if (btn.nextElementSibling?.classList?.contains('checkmark-confirm')) return;

  const check = document.createElement('span');
  check.innerHTML = '✔️';
  check.className = 'checkmark-confirm';
  check.style.marginLeft = '8px';
  check.style.color = 'green';
  check.style.fontSize = '1rem';

  btn.parentNode.insertBefore(check, btn.nextSibling);

  setTimeout(() => {
    check.remove();
  }, 5000);
}

// Display a red cross icon near a button to indicate failure to load/save data
function showFailureCross(btn) {
  if (!btn) return;

  // Ensure the parent container is relative
  btn.style.position = 'relative';

  // Avoid duplicate crosses
  if (btn.parentNode.querySelector('.cross-fail')) return;

  const cross = document.createElement('span');
  cross.innerHTML = '❌';
  cross.className = 'cross-fail';
  cross.style.position = 'absolute';
  cross.style.top = '50%';
  cross.style.left = '100%';
  cross.style.transform = 'translate(0, -50%)';
  cross.style.marginLeft = '8px';
  cross.style.color = 'red';
  cross.style.fontSize = '1rem';
  cross.style.pointerEvents = 'none';

  btn.parentNode.style.position = 'relative';
  btn.parentNode.appendChild(cross);

  setTimeout(() => {
    cross.remove();
  }, 5000);
}

// Disable a button and replace its content with a loading spinner and label
function showLoading(btn, text = "Loading...") {
  if (!btn) return;
  btn.disabled = true;
  btn.dataset.originalText = btn.innerHTML;

  btn.innerHTML = `
    <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
    ${text}
  `;
}

// Restore a button's original state and re-enable it after loading is complete
function hideLoading(btn) {
  if (!btn) return;
  btn.disabled = false;
  if (btn.dataset.originalText) {
    btn.innerHTML = btn.dataset.originalText;
    delete btn.dataset.originalText;
  }
}


// Load all projects once the page is ready
document.addEventListener("DOMContentLoaded", async () => {
  await loadProductionData(); 
  loadProjects();           
});