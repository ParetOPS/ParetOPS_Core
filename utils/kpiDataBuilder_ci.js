/**
 * kpiDataBuilder_ci.js- CONFIDENTIAL - PROPERTY OF PARETOPS
 * 
 * For support or integration questions, contact: support@paretops.com
 * 
 * This module powers the Continuous Improvement (CI) section of the ParetOPS software.
 * It provides backend logic and API routes to support full lifecycle management of Lean/DMAIC projects,
 * including data tracking, KPI benchmarking, and project closure.
 * 
 * KEY FEATURES:
 * • Project creation and phase tracking: Define, Measure, Analyze, Improve, Control, Close
 * • Persistent storage of textual inputs (problem statements, impacts, outcomes)
 * • KPI data freeze for comparative benchmarking over time
 * • Shift/machine-specific metric tracking for CI evaluations
 * • Base64 image support for trend graphs, paretos, and histograms (uploaded by frontend)
 * • Automatic file saving for visuals and project PDFs (stored in /public/analyze and /public/improve)
 * • Comprehensive project deletion including all child records
 * 
 * API GROUPS:
 * 1. Projects:
 *    - Create, update, and delete CI projects
 *    - Assign tracked machines
 * 
 * 2. Define Phase:
 *    - Store problem definition and estimated impact
 * 
 * 3. Measure Phase:
 *    - Store and retrieve KPI averages across machines and time ranges
 *    - Freeze raw data snapshots for traceability
 * 
 * 4. Analyze Phase:
 *    - Save analysis comments, KPIs, and uploaded images (trends, paretos, logs)
 * 
 * 5. Improve Phase:
 *    - Save planned improvements, visual evidence, and comparison graphics
 * 
 * 6. Control Phase:
 *    - Store checklist responses and control plan comments
 * 
 * 7. Closure Phase:
 *    - Log closure date, measured impact, and final comments
 * 
 * 8. Shared:
 *    - `getCiKpiData()` extracts production KPIs from the global module (filtered down to what's useful for CI)
 * 
 * WARNING:
  - Managed under Git. Tag any changes that impact frontend structure or KPI logic.
 * Ensure any file writes (base64 image decoding) happen in secure, scoped paths to avoid file collisions.
 * 
 * AUTHOR: Paulin Colin BANCKAERT
 * VERSION: v3.0.0
 */


// Load environment variables and database connection
require('dotenv').config();
const express = require('express');
const router = express.Router();
const mysql = require('mysql2');
const { getAustinDateStringFromISO } = require('./utils.server');
const { getKpiData } = require('./kpiDataBuilder');
const fs = require('fs');
const path = require('path');


const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  timezone: 'Z',
  waitForConnections: true,
  connectionLimit: 10
});

function base64ToFile(dataUrl, filename) {
  if (!dataUrl?.startsWith("data:image")) return null;

  const base64 = dataUrl.split(',')[1];
  const buffer = Buffer.from(base64, 'base64');
  const dir = path.join(__dirname, '../public/improve');
  const fullPath = path.join(dir, filename);

  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); // 🔁 remplace l'ancien fichier

  fs.writeFileSync(fullPath, buffer);
  return `/improve/${filename}`;
}


// Get the list of all CI projects with their status and optional closure outcome
router.get('/api/get-projects', (req, res) => {
  const sql = `
    SELECT 
      p.id,
      p.name AS title,
      p.start_date,
      p.closure_date,
      p.status,
      d.outcome
    FROM projects p
    LEFT JOIN project_close_data d ON p.id = d.project_id
    ORDER BY p.id DESC
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error("❌ Failed to load projects:", err);
      return res.status(500).json({ error: 'DB error' });
    }
    res.json(rows);
  });
});

// Create a new CI project (default phase is 'Define')
router.post('/api/create-project', (req, res) => {
  const { name, start_date, closure_date } = req.body;
  if (!name || !start_date) return res.status(400).json({ error: 'Missing required data' });

  db.query(
    'INSERT INTO projects (name, start_date, closure_date, status) VALUES (?, ?, ?, ?)',
    [name, start_date, closure_date || null, 'Define'],
    (err) => {
      if (err) return res.status(500).json({ error: 'Insert failed' });
      res.json({ success: true });
    }
  );
});

// Retrieve Define phase data (problem definition and estimated impact)
router.get('/api/define/:projectId', (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project ID' });

  const sql = `SELECT * FROM project_define_data WHERE project_id = ?`;
  db.query(sql, [projectId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows[0] || null); // null si pas encore de données
  });
});

// Save or update Define phase data for a specific project
router.post('/api/define/:projectId', (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  const { problem_definition, estimated_impact } = req.body;

  if (!projectId) return res.status(400).json({ error: 'Missing project ID' });

  const sql = `
    INSERT INTO project_define_data (project_id, problem_definition, estimated_impact)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE
      problem_definition = VALUES(problem_definition),
      estimated_impact = VALUES(estimated_impact)
  `;

  db.query(sql, [projectId, problem_definition, estimated_impact], (err) => {
    if (err) {
      console.error("❌ MySQL error:", err);
      return res.status(500).json({ error: 'Insert/update failed' });
    }
    res.json({ success: true });
  });
});

// Update the official closure date of a project
router.patch('/api/projects/:id/closure', (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const { closure_date } = req.body;

  if (!projectId) return res.status(400).json({ error: 'Invalid project ID' });

  const sql = 'UPDATE projects SET closure_date = ? WHERE id = ?';
  db.query(sql, [closure_date || null, projectId], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to update closure date' });
    res.json({ success: true });
  });
});

// Update the core fields of a project (name, start date, closure date)
router.patch('/api/projects/:id/core', (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const { name, start_date, closure_date } = req.body;

  if (!projectId || !name || !start_date) {
    return res.status(400).json({ error: 'Missing project data' });
  }

  const sql = `UPDATE projects SET name = ?, start_date = ?, closure_date = ? WHERE id = ?`;

  db.query(sql, [name, start_date, closure_date || null, projectId], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to update project core data' });
    res.json({ success: true });
  });
});

// Get the list of machines assigned to a project
router.get('/api/projects/:id/machines', (req, res) => {
  const projectId = parseInt(req.params.id, 10);

  if (!projectId) return res.status(400).json({ error: 'Invalid project ID' });

  const sql = 'SELECT machine_name FROM project_machines WHERE project_id = ?';
  db.query(sql, [projectId], (err, rows) => {
    if (err) {
      console.error("❌ Error fetching project machines:", err);
      return res.status(500).json({ error: 'Failed to load machines' });
    }

    res.json(rows.map(row => row.machine_name));
  });
});

// Save a new machine list for a project (overwrites previous values)
router.post('/api/projects/:id/machines', (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const { machines } = req.body;

  if (!projectId || !Array.isArray(machines)) {
    return res.status(400).json({ error: 'Invalid project ID or machines array' });
  }

  // Delete existing machine assignments
  db.query('DELETE FROM project_machines WHERE project_id = ?', [projectId], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to clear old machines' });

    if (machines.length === 0) return res.json({ success: true }); // no machine to insert

    const values = machines.map(name => [projectId, name]);
    db.query('INSERT INTO project_machines (project_id, machine_name) VALUES ?', [values], (err2) => {
      if (err2) {
        console.error("❌ Machine insert error:", err2);
        return res.status(500).json({ error: 'Failed to insert new machines' });
      }
      res.json({ success: true });
    });
  });
});

// Update the current status of a project (e.g., from Define to Measure)
router.patch('/api/projects/:id/status', (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  const { status } = req.body;

  if (!projectId || !status) {
    return res.status(400).json({ error: 'Missing status or ID' });
  }

  db.query('UPDATE projects SET status = ? WHERE id = ?', [status, projectId], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to update status' });
    res.json({ success: true });
  });
});

// Measure section
// Store average KPI values per machine, per KPI, for a selected time range
router.post('/api/measure/store', (req, res) => {
  const { projectId, range, kpis, machines, values } = req.body;

  if (!projectId || !range || !Array.isArray(kpis) || !Array.isArray(machines) || typeof values !== 'object') {
    return res.status(400).json({ error: 'Invalid data format' });
  }

  const rows = [];
  kpis.forEach(kpi => {
    machines.forEach(machine => {
      const val = values?.[kpi]?.[machine] ?? null;
      rows.push([projectId, range, kpi, machine, val]);
    });
  });

  const sql = `
    INSERT INTO project_measure_data (project_id, range_days, kpi_name, machine_name, mean_value)
    VALUES ?
    ON DUPLICATE KEY UPDATE
      range_days = VALUES(range_days),
      mean_value = VALUES(mean_value)
  `;

  db.query(sql, [rows], (err) => {
    if (err) {
      console.error("❌ Failed to insert measure data:", err);
      return res.status(500).json({ error: 'DB insert error' });
    }
    res.json({ success: true });
  });
});

// Retrieve stored KPI averages for a given project
router.get('/api/measure/:projectId', (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project ID' });

  const sql = `
    SELECT kpi_name, machine_name, mean_value, range_days
    FROM project_measure_data
    WHERE project_id = ?
  `;

  db.query(sql, [projectId], (err, rows) => {
    if (err) {
      console.error("❌ Failed to fetch measure data:", err);
      return res.status(500).json({ error: 'DB fetch error' });
    }

    const values = {};
    let range = null;

    rows.forEach(row => {
      const { kpi_name, machine_name, mean_value, range_days } = row;
      if (!values[kpi_name]) values[kpi_name] = {};
      values[kpi_name][machine_name] = mean_value;
      range = range_days;
    });

    res.json({ range, values });
  });
});

// Helper function to retrieve full KPI data from the global dataset
async function getCiKpiData() {
  const fullData = await getKpiData();
  return { kpis: fullData.kpis }; // on ne garde que la partie utile pour le CI
}

// Endpoint to fetch CI-specific KPI data used during the Measure phase
router.get('/api/kpi_ci', async (req, res) => {
  try {
    const data = await getCiKpiData();
    res.json(data);
  } catch (err) {
    console.error("❌ Failed to load CI KPIs:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Save detailed KPI snapshots during the Measure phase (used for comparison and analysis)
router.post('/api/freeze-measure', (req, res) => {
  const { projectId, kpi, range, rows } = req.body;

  if (!projectId || !kpi || !range || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'Missing or invalid payload' });
  }

  const values = rows.map(row => [
    projectId,
    kpi,
    row.date,
    row.machine,
    row.value,
    range
  ]);

  const sql = `
    INSERT INTO frozen_measure_data (project_id, kpi, value_date, machine, value, range_days)
    VALUES ?
    ON DUPLICATE KEY UPDATE
      value = VALUES(value),
      range_days = VALUES(range_days),
      updated_at = CURRENT_TIMESTAMP

  `;

  db.query(sql, [values], (err) => {
    if (err) {
      console.error("❌ Failed to insert frozen data:", err);
      return res.status(500).json({ error: 'Insert failed' });
    }
    res.json({ success: true });
  });
});

// load data from kpi on measure phase
router.get('/api/frozen-measure/:projectId', (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  if (!projectId) return res.status(400).json({ error: 'Invalid project ID' });

  const sql = `
    SELECT kpi, value_date, machine, value, range_days
    FROM frozen_measure_data
    WHERE project_id = ?
    ORDER BY created_at DESC
  `;

  db.query(sql, [projectId], (err, rows) => {
    if (err) {
      console.error("❌ Failed to load frozen measure data:", err);
      return res.status(500).json({ error: 'DB error' });
    }

    const data = {};
    let range = null;

    rows.forEach(row => {
      const { kpi, value_date, machine, value, range_days } = row;
      if (!data[kpi]) data[kpi] = [];
      data[kpi].push({ date: value_date, machine, value });
      range = range_days;
    });

    res.json({ range, data });
  });
});

// ANALYZE SECTION
// Save Analyze phase metadata (statistics HTML and logs)
router.post('/api/analyze/meta/:projectId', (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  const { statsHTML, logsMaintenance, logsProduction } = req.body;

  const sql = `
    INSERT INTO project_analyze_data (
      project_id, stats_html, logs_maintenance, logs_production
    ) VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      stats_html = VALUES(stats_html),
      logs_maintenance = VALUES(logs_maintenance),
      logs_production = VALUES(logs_production),
      updated_at = CURRENT_TIMESTAMP
  `;

  db.query(sql, [projectId, statsHTML, logsMaintenance, logsProduction], (err) => {
    if (err) {
      console.error("❌ Failed to save analyze meta:", err);
      return res.status(500).json({ success: false });
    }
    res.json({ success: true });
  });
});

// Save Analyze phase images (trend and Pareto charts)
router.post('/api/analyze/images/:projectId', (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  const { imgTrend, imgParetoMaint, imgParetoProd } = req.body;

  const base64ToFile = (dataUrl, filename) => {
    if (!dataUrl?.startsWith("data:image")) return null;
    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
    const dir = path.join(__dirname, '../public/analyze');
    const fullPath = path.join(dir, filename);

    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    fs.writeFileSync(fullPath, buffer);
    return `/analyze/${filename}`;
  };

  const timestamp = Date.now();
  const trendPath = base64ToFile(imgTrend, `${projectId}_trend_${timestamp}.jpg`);
  const paretoMaintPath = base64ToFile(imgParetoMaint, `${projectId}_paretoMaint_${timestamp}.jpg`);
  const paretoProdPath = base64ToFile(imgParetoProd, `${projectId}_paretoProd_${timestamp}.jpg`);

  const sql = `
    INSERT INTO project_analyze_data (
      project_id, img_trend_path, img_pareto_maint_path, img_pareto_prod_path
    ) VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      img_trend_path = VALUES(img_trend_path),
      img_pareto_maint_path = VALUES(img_pareto_maint_path),
      img_pareto_prod_path = VALUES(img_pareto_prod_path),
      updated_at = CURRENT_TIMESTAMP

  `;

  const values = [projectId, trendPath, paretoMaintPath, paretoProdPath];

  db.query(sql, values, (err) => {
    if (err) {
      console.error("❌ Failed to save analyze images:", err);
      return res.status(500).json({ success: false });
    }
    res.json({ success: true });
  });
});

// Load Analyze phase data for a given project
router.get('/api/analyze/:projectId', (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  const sql = `
    SELECT
      stats_html,
      logs_maintenance,
      logs_production,
      img_trend_path,
      img_pareto_maint_path,
      img_pareto_prod_path,
      updated_at
    FROM project_analyze_data
    WHERE project_id = ?
  `;

  db.query(sql, [projectId], (err, rows) => {
    if (err) {
      console.error("❌ Failed to load analyze data:", err);
      return res.status(500).json({});
    }
    res.json(rows[0] || {});
  });
});


// IMPROVE SECTION (BASIC ENTRY)
// Save single improvement idea (basic view: name, impact, status, etc.)
router.post('/api/improve/:projectId', (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  const { name, description, effective_date, status, estimated_impact, target_kpi } = req.body;

  if (!projectId || !name || !target_kpi) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const sql = `
    INSERT INTO project_improve_data 
      (project_id, name, description, effective_date, status, estimated_impact, target_kpi)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      description = VALUES(description),
      effective_date = VALUES(effective_date),
      status = VALUES(status),
      estimated_impact = VALUES(estimated_impact),
      target_kpi = VALUES(target_kpi)
  `;

  db.query(sql, [projectId, name, description, effective_date, status, estimated_impact, target_kpi], (err) => {
    if (err) {
      console.error("❌ Error saving improvement:", err);
      return res.status(500).json({ error: 'Failed to save improvement' });
    }

    res.json({ success: true });
  });
});

// IMPROVE SECTION (FULL ENTRY - MULTI-STAGE UI)
// Save metadata for full Improve entry (first load): content and comparisons
router.get('/api/improve/:projectId', (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  const sql = `SELECT * FROM project_improve_data WHERE project_id = ?`;

  db.query(sql, [projectId], (err, rows) => {
    if (err) {
      console.error("❌ Error fetching improvement data:", err);
      return res.status(500).json({ error: 'Failed to load improvement' });
    }
    res.json(rows[0] || null);
  });
});

// Save graph images for Improve phase (second load)
router.post('/api/improve/full/meta/:projectId', (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  const {
    name, description, effective_date, status,
    estimated_impact, target_kpi, table_html,
    stats_html, comparison_html
  } = req.body;

  const sql = `
    INSERT INTO improve_full (
      project_id, name, description, effective_date, status,
      estimated_impact, target_kpi, table_html, stats_html, comparison_html
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      description = VALUES(description),
      effective_date = VALUES(effective_date),
      status = VALUES(status),
      estimated_impact = VALUES(estimated_impact),
      target_kpi = VALUES(target_kpi),
      table_html = VALUES(table_html),
      stats_html = VALUES(stats_html),
      comparison_html = VALUES(comparison_html),
      updated_at = CURRENT_TIMESTAMP
  `;

  const values = [
    projectId, name, description, effective_date || null,
    status, estimated_impact, target_kpi,
    table_html, stats_html, comparison_html
  ];

  db.query(sql, values, err => {
    if (err) {
      console.error("❌ Failed to save meta improve:", err);
      return res.status(500).json({ success: false });
    }
    res.json({ success: true });
  });
});

// Save Pareto images for Improve phase (third load)
router.post('/api/improve/full/graphs/:projectId', (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  const {
    img_histogram, img_trend, img_compare_hist, img_compare_trend
  } = req.body;

  const timestamp = Date.now();

  const sql = `
    UPDATE improve_full SET
      img_histogram_path = ?,
      img_trend_path = ?,
      img_compare_hist_path = ?,
      img_compare_trend_path = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE project_id = ?
  `;

  const values = [
    base64ToFile(img_histogram, `${projectId}_hist_${timestamp}.jpg`),
    base64ToFile(img_trend, `${projectId}_trend_${timestamp}.jpg`),
    base64ToFile(img_compare_hist, `${projectId}_comp_hist_${timestamp}.jpg`),
    base64ToFile(img_compare_trend, `${projectId}_comp_trend_${timestamp}.jpg`),
    projectId
  ];

  db.query(sql, values, err => {
    if (err) {
      console.error("❌ Failed to save graphs:", err);
      return res.status(500).json({ success: false });
    }
    res.json({ success: true });
  });
});

// Load the complete Improve record including images and HTML for a given project
router.post('/api/improve/full/paretos/:projectId', (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  const {
    img_pareto_maint, img_pareto_prod
  } = req.body;

  const timestamp = Date.now();

  const sql = `
    UPDATE improve_full SET
      img_pareto_maint_path = ?,
      img_pareto_prod_path = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE project_id = ?
  `;

  const values = [
    base64ToFile(img_pareto_maint, `${projectId}_paretoMaint_${timestamp}.jpg`),
    base64ToFile(img_pareto_prod, `${projectId}_paretoProd_${timestamp}.jpg`),
    projectId
  ];

  db.query(sql, values, err => {
    if (err) {
      console.error("❌ Failed to save paretos:", err);
      return res.status(500).json({ success: false });
    }
    res.json({ success: true });
  });
});

// Load full Improve data including images and saved HTML
router.get('/api/improve/full/:projectId', (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  const sql = `
    SELECT
      name, description, effective_date, status, estimated_impact, target_kpi,
      table_html, stats_html, comparison_html,
      img_histogram_path, img_trend_path,
      img_compare_hist_path, img_compare_trend_path,
      img_pareto_maint_path, img_pareto_prod_path,
      updated_at
    FROM improve_full WHERE project_id = ?
  `;

  db.query(sql, [projectId], (err, rows) => {
    if (err) {
      console.error("❌ Failed to load improve full data:", err);
      return res.status(500).json({});
    }
    res.json(rows[0] || {});
  });
});

// CONTROL SECTION
// Save control phase checklist and comment for a project
router.post('/api/control/:projectId', (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  const { checks, comment } = req.body;

  if (!Array.isArray(checks) || checks.length !== 6) {
    return res.status(400).json({ error: "Invalid checklist." });
  }

  const sql = `
    INSERT INTO project_control_data (
      project_id, check_0, check_1, check_2, check_3, check_4, check_5, comment
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      check_0 = VALUES(check_0),
      check_1 = VALUES(check_1),
      check_2 = VALUES(check_2),
      check_3 = VALUES(check_3),
      check_4 = VALUES(check_4),
      check_5 = VALUES(check_5),
      comment = VALUES(comment),
      updated_at = CURRENT_TIMESTAMP
  `;

  const values = [projectId, ...checks.map(v => !!v), comment || null];

  db.query(sql, values, err => {
    if (err) {
      console.error("❌ Failed to save control data:", err);
      return res.status(500).json({ success: false });
    }
    res.json({ success: true });
  });
});

// Load saved control data (checklist and comment)
router.get('/api/control/:projectId', (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  const sql = `SELECT * FROM project_control_data WHERE project_id = ?`;

  db.query(sql, [projectId], (err, rows) => {
    if (err) {
      console.error("❌ Failed to load control data:", err);
      return res.status(500).json({});
    }
    res.json(rows[0] || {});
  });
});


// CLOSURE SECTION
// Save closure data (actual closure date, measured impact, final outcome)
router.post('/api/close/:projectId', (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  const { actual_closure_date, measured_impact, comment, outcome } = req.body;

  const sql = `
    INSERT INTO project_close_data (project_id, actual_closure_date, measured_impact, comment, outcome)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      actual_closure_date = VALUES(actual_closure_date),
      measured_impact = VALUES(measured_impact),
      comment = VALUES(comment),
      outcome = VALUES(outcome),
      updated_at = CURRENT_TIMESTAMP
  `;

  db.query(sql, [projectId, actual_closure_date || null, measured_impact, comment || null, outcome || null], (err) => {
    if (err) {
      console.error("❌ Failed to save closure:", err);
      return res.status(500).json({ success: false });
    }
    res.json({ success: true });
  });
});

// Load previously saved closure information
router.get('/api/close/:projectId', (req, res) => {
  const projectId = parseInt(req.params.projectId, 10);
  db.query('SELECT * FROM project_close_data WHERE project_id = ?', [projectId], (err, rows) => {
    if (err) {
      console.error("❌ Failed to load closure data:", err);
      return res.status(500).json({});
    }
    res.json(rows[0] || {});
  });
});

// Permanently delete a project and all related data from all CI tables
router.delete('/api/delete-project/:id', (req, res) => {
  const projectId = parseInt(req.params.id, 10);
  if (!projectId) return res.status(400).json({ error: "Invalid project ID" });

  // List of tables that store data linked to the project via project_id
  const relatedTables = [
    "project_close_data",
    "project_control_data",
    "project_define_data",
    "project_machines",
    "project_measure_data",
    "frozen_measure_data",
    "project_analyze_data",
    "project_improve_data",
    "improve_full"
  ];

  // Create delete promises for all related tables
  const deleteRelatedData = relatedTables.map(table => {
    const sql = `DELETE FROM ${table} WHERE project_id = ?`;
    return new Promise((resolve, reject) => {
      db.query(sql, [projectId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  // Add deletion of the main project row (uses column 'id' instead of 'project_id')
  const deleteMainProject = new Promise((resolve, reject) => {
    db.query(`DELETE FROM projects WHERE id = ?`, [projectId], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Execute all deletions in parallel
  Promise.all([...deleteRelatedData, deleteMainProject])
    .then(() => res.json({ success: true }))
    .catch(err => {
      console.error("❌ Failed to delete project data:", err);
      res.status(500).json({ error: "Failed to delete project data" });
    });
});

module.exports = {
  getCiKpiData,
  ciRouter: router 
};