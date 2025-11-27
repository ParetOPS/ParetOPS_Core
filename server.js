/**
 * server.js - CONFIDENTIAL - PROPERTY OF PARETOPS 
 * 
 * please contact support@paretops.com
 * 
 * This file initializes and runs the backend server for the ParetOPS web application.
 * It is responsible for serving frontend HTML pages, handling all API routes, managing
 * real-time communication via WebSockets (Socket.IO), and connecting to the MySQL database.
 * 
 * TECHNOLOGIES USED:
 * - Node.js (Express): Web server framework
 * - Socket.IO: Real-time bidirectional communication
 * - MySQL (via mysql2): Backend database for production, maintenance, and quality data
 * - dotenv: Loads environment variables from a `.env` file
 * 
 * CORE FEATURES:
 * 1. Static content delivery for multiple HTML-based interfaces (leader, production, maintenance, etc.)
 * 2. Secure login POST-based authentication for leader dashboard
 * 3. API routes for:
 *    - Production planning and updates
 *    - Maintenance logging and retrieval
 *    - Issue reporting and pareto analysis
 *    - Real-time machine status tracking
 *    - KPI retrieval for production, maintenance, and continuous improvement
 * 4. WebSocket broadcasting to keep the frontend updated in real-time
 *    - Includes shift updates, help requests, machine status, and productivity counters
 * 
 * DATABASE:
 * This application connects to a MySQL database. Connection parameters are defined 
 * in the `.env` file (MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE).
 * 
 * DEPLOYMENT:
 * - The server listens on a configurable port (default: 3000).
 * - Uses reverse proxy (IIS) and HTTPS on the client side in production.
 * - Static content is served from the `/public` directory.
 * - The server is compatible with internal production and testing environments.
 * 
 * NOTES:
 * - The file includes several critical insert/update/select SQL queries
 *   that must be tested before modifying the schema or data logic.
 * - WebSocket connections are used to reduce polling and improve reactivity.
 * - Changes to this file can impact data integrity and frontend behavior.
 *   Be cautious when editing endpoints or WebSocket broadcasts.
 * 
 * AUTHOR:
 * Paulin Colin BANCKAERT — Last major version: v3.0.0
 * 
 * VERSIONING:
 * This file is tracked under Git. Use tags to trace deployment versions.
 */

process.env.TZ = 'America/Chicago';

const now = new Date();
console.log("🕒 Local time:", now.toString());
console.log("🌍 UTC ISO:   ", now.toISOString());

const express = require('express');
require('dotenv').config();

const app = express();
console.log("🕒 Current system time:", new Date().toString());

const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: {
        origin: process.env.CORS_ORIGIN || "*", // 🔥 Sécurisé
        methods: ["GET", "POST"]
    }
});
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const { getKpiData, router: kpiPreferencesRouter } = require('./utils/kpiDataBuilder');
const { getMaintenanceKpiData, maintenanceRouter } = require('./utils/kpiDataBuilder_maintenance');
const { getCiKpiData, ciRouter } = require('./utils/kpiDataBuilder_ci');
const fs = require('fs');
const path = require('path');
// ====== Load multi-client configuration (ParetOPS Core by default) ======
const configPath =
  process.env.COMPANY_CONFIG_FILE ||
  path.join(__dirname, 'config', 'paretops_core.json');

let appConfig = {
  company: { name: 'ParetOPS Core Manufacturing', department: 'Production' },
  machines: [],
  shifts: 3,
  productionSetup: {
    programs: {},
    traineeReductionFactor: 0.7
  }
};

try {
  const rawConfig = fs.readFileSync(configPath, 'utf8');
  appConfig = JSON.parse(rawConfig);
  console.log('✅ Loaded company config from', configPath);
} catch (err) {
  console.warn('⚠️ Could not load company config file:', configPath, '-', err.message);
  console.warn('   Using default in-memory config.');
}


// Middleware
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(kpiPreferencesRouter);
app.use(maintenanceRouter);
app.use(ciRouter);
app.use('/reports', express.static(path.join(__dirname, 'utils', 'reports')));
app.use('/improve', express.static(path.join(__dirname, 'public', 'improve')));
app.use('/analyze', express.static(path.join(__dirname, 'public', 'analyze')));
app.use(express.json({ limit: '250mb' }));
app.use(express.urlencoded({ extended: true, limit: '250mb' }));
// Middleware to check password before accessing /leader.html
app.post('/leader-auth', express.json(), (req, res) => {
    const { password } = req.body;
    if (password === process.env.LEADER_PASSWORD) {
        res.sendStatus(200); // Success
    } else {
        res.sendStatus(401); // Unauthorized
    }
});



//const { maintenanceRouter } = require('./utils/kpiDataBuilder_maintenance');

//app.use('/api', maintenanceRouter);

// Helper function: Get Austin timestamp (yyyy-mm-dd hh:mm:ss)
function getAustinTimestamp() {
    const now = new Date();
    const options = {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(now);
    const dateParts = {};
    parts.forEach(part => dateParts[part.type] = part.value);
    return `${dateParts.year}-${dateParts.month}-${dateParts.day} ${dateParts.hour}:${dateParts.minute}:${dateParts.second}`;
}
// TRIAL to avoid rollback at 7pm
// Helper: today's date in America/Chicago as 'YYYY-MM-DD'
function centralDayYMD() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}



// MySQL Connection
const db = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    timezone: 'Z',
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0
});

// WebSocket Logic
io.on('connection', (socket) => {
    console.log('🔗 A user connected');

    socket.on("shiftChanged", (data) => {
        console.log(`📢 Shift changed: ${data.shift}`);
        io.emit("shiftChanged", data);
    });

    socket.on('refreshRealTimeStatus', () => {
        db.query('SELECT plyCutter, status FROM machine_status', (err, results) => {
            if (err) {
                console.error("❌ Database error:", err);
                return;
            }
            io.emit('updateMachineStatus', results);  // ✅ Send status updates to frontend
        });
    });

    socket.on('helpRequested', (data) => {
        if (!data || typeof data.helpRequested === "undefined") {
            console.error("❌ Missing helpRequested:", data);
            return;
        }
    
        const { plyCutter, helpRequested } = data;
        const daySafe = centralDayYMD();
        db.query(
            `UPDATE ply_cutter_obj 
             SET help_requested = ? 
             WHERE plyCutter = ? 
               AND day = ? 
               AND shift = (SELECT shift FROM shift_tracking WHERE id = 1)`,
            [helpRequested, plyCutter, daySafe], 
            (updateErr) => {
                if (updateErr) {
                    console.error(`❌ Error updating help status:`, updateErr);
                    return;
                }
    
                // ✅ Only emit plyCutter and helpRequested state
                io.emit('machineDataUpdated', { 
                    plyCutter,
                    helpRequested
                });
            }
        );
    });
    
    

    socket.on('disconnect', () => {
        console.log('🔌 A user disconnected');
    });
});

// Serve Frontend Pages
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});
// Middleware to check password before accessing /leader.html
// Secure leader login using POST (no password in URL)
app.post('/leader-auth', express.json(), (req, res) => {
    const { password } = req.body;
    if (password === process.env.LEADER_PASSWORD) {
        res.sendStatus(200); // Success
    } else {
        res.sendStatus(401); // Unauthorized
    }
});

// Serves the Leader dashboard (password-protected view for management).
app.get('/leader.html', (req, res) => {
    res.sendFile(__dirname + '/public/leader.html');
});

// Loads the main production interface used by operators.
app.get('/production.html', (req, res) => {
    res.sendFile(__dirname + '/public/production.html');
});

// Loads the main maintenance interface for planned/unplanned events.
app.get('/maintenance.html', (req, res) => {
    res.sendFile(__dirname + '/public/maintenance.html');
});

// ====== Expose configuration (company, machines, programs, shifts) ======
app.get('/api/config', (req, res) => {
  res.json(appConfig);
});

// Interface to define and assign daily objectives per ply cutter.
app.get('/production-setup', (req, res) => {
    res.sendFile(__dirname + '/public/production_plycutter_setup.html');
});

// Displays live machine statuses (e.g. UP/DOWN, help needed).
app.get('/real_time_status', (req, res) => {
    res.sendFile(__dirname + '/public/real_time_status.html');
});

// KPI dashboard for production performance metrics.
app.get('/production_kpi', (req, res) => {
    res.sendFile(__dirname + '/public/production_kpi.html');
});

// KPI dashboard for maintenance performance metrics.
app.get('/maintenance_kpi', (req, res) => {
    res.sendFile(__dirname + '/public/maintenance_kpi.html');
});

// Pareto analysis view for reported issues (downtime categorization).
app.get('/pareto', (req, res) => {
    res.sendFile(__dirname + '/public/pareto.html');
});

// Shows production metrics and input controls for a specific ply cutter.
app.get('/production_screen/:plyCutter', (req, res) => {
    res.sendFile(__dirname + '/public/production_screen.html');
});

// Shows maintenance logs and inputs for a specific ply cutter.
app.get('/maintenance_screen/:plyCutter', (req, res) => {
    res.sendFile(__dirname + '/public/maintenance_screen.html');
});

// Static contact information page for technical support or inquiries.
app.get('/contact', (req, res) => {
    res.sendFile(__dirname + '/public/contact.html');
});

// Displays KPIs and tools for continuous improvement (DMAIC projects).
app.get('/continuous_improvement_kpi', (req, res) => {
    res.sendFile(__dirname + '/public/continuous_improvement_kpi.html');
});

// Saves objective rows for a given shift for the **Austin local day**.
// IMPORTANT:
// - We DO NOT trust the client's `day` for writes. We always compute the day server-side
//   in America/Chicago to avoid midnight-UTC rollover issues.
// - For each submitted row (plyCutter), we ensure the row exists for (plyCutter, shift, dayUsed)
//   and then update objective fields atomically.
// - Finally, we read back and broadcast updates so all screens stay in sync.
app.post('/api/save-data', (req, res) => {
  try {
    const { shift, /* day (ignored) */ data } = req.body;

    // ---- 1) Validate payload ----
    if (!shift || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: "Missing required fields (need shift and non-empty data[])" });
    }
    const shiftNum = Number(shift);
    if (!Number.isFinite(shiftNum)) {
      return res.status(400).json({ error: "Invalid shift number" });
    }

    // ---- 2) Compute the authoritative Austin day on the server ----
    const dayUsed = (typeof centralDayYMD === 'function')
      ? centralDayYMD()
      : (() => {
          const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'
          }).formatToParts(new Date());
          const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
          return `${m.year}-${m.month}-${m.day}`;
        })();

    // For observability at midnight UTC windows
    console.log('[SAVE DATA] request', {
      shift: shiftNum,
      rows: data.length,
      dayUsed,
      isoServer: new Date().toISOString()
    });

    // ---- 3) Prepare helpers (ensure row then update fields) ----
    const ensureSql = `
      INSERT INTO ply_cutter_obj (plyCutter, shift, day, obj_value, prod_value, program, floater, trainee, submitted, help_requested, updated_at)
      SELECT ?, ?, ?, 0, 0, 'N/A', 0, 0, 0, 0, UTC_TIMESTAMP()
      WHERE NOT EXISTS (
        SELECT 1 FROM ply_cutter_obj WHERE plyCutter = ? AND shift = ? AND day = ?
      )
    `;

    const updateSql = `
      UPDATE ply_cutter_obj
         SET program = ?,
             trainee = ?,
             floater = ?,
             obj_value = ?,
             submitted = ?,
             updated_at = UTC_TIMESTAMP()
       WHERE plyCutter = ? AND shift = ? AND day = ?
    `;

    const readSql = `
      SELECT plyCutter, shift, day, obj_value, program, trainee, floater, submitted
        FROM ply_cutter_obj
       WHERE plyCutter = ? AND shift = ? AND day = ?
       LIMIT 1
    `;

    // ---- 4) Process rows sequentially (clear, simple; dataset is small per shift) ----
    const rows = Array.from(data);
    const results = [];

    const processNext = () => {
      const row = rows.shift();
      if (!row) {
        // All rows done → respond
        return res.json({ ok: true, day: dayUsed, shift: shiftNum, count: results.length, rows: results });
      }

      const {
        plyCutter,
        program,
        trainee,
        floater,
        output_obj,  // objective value from UI
        submitted
      } = row || {};

      if (!plyCutter) {
        console.warn('[SAVE DATA] Skipping row with missing plyCutter:', row);
        return processNext();
      }

      // Coerce/normalize values safely
      const programVal = (program ?? 'N/A');
      const traineeVal = !!trainee ? 1 : 0;
      const floaterVal = !!floater ? 1 : 0;
      const objVal = Number(output_obj) >= 0 ? Number(output_obj) : 0;
      const submittedVal = !!submitted ? 1 : 0;

      // 4.1 Ensure row exists
      db.query(
        ensureSql,
        [plyCutter, shiftNum, dayUsed, plyCutter, shiftNum, dayUsed],
        (ensureErr) => {
          if (ensureErr) {
            console.error('❌ Ensure row error:', ensureErr);
            // Continue processing other rows but record error
            results.push({ plyCutter, error: 'ensure_failed', details: ensureErr.message });
            return processNext();
          }

          // 4.2 Update objective fields
          db.query(
            updateSql,
            [programVal, traineeVal, floaterVal, objVal, submittedVal, plyCutter, shiftNum, dayUsed],
            (updateErr) => {
              if (updateErr) {
                console.error('❌ Update row error:', updateErr);
                results.push({ plyCutter, error: 'update_failed', details: updateErr.message });
                return processNext();
              }

              // 4.3 Read back & broadcast
              db.query(readSql, [plyCutter, shiftNum, dayUsed], (readErr, rowsOut) => {
                if (readErr) {
                  console.error('❌ Read-back error:', readErr);
                  results.push({ plyCutter, error: 'read_failed', details: readErr.message });
                  return processNext();
                }

                const saved = rowsOut && rowsOut[0] ? rowsOut[0] : {
                  plyCutter, shift: shiftNum, day: dayUsed,
                  obj_value: objVal, program: programVal, trainee: traineeVal, floater: floaterVal, submitted: submittedVal
                };

                // Broadcast so the other screens reflect the change instantly
                io.emit('machineDataUpdated', {
                  plyCutter: saved.plyCutter,
                  shift: saved.shift,
                  day: saved.day,
                  program: saved.program,
                  obj_value: saved.obj_value
                });
                io.emit('refreshRealTimeStatus');

                results.push(saved);
                processNext();
              });
            }
          );
        }
      );
    };

    processNext();
  } catch (err) {
    console.error('❌ /api/save-data exception:', err);
    res.status(500).json({ error: 'Unexpected error in /api/save-data', details: err?.message });
  }
});


// Returns production KPI data (for real-time charts, benchmarking, or analysis).
app.get('/api/kpi', async (req, res) => {
    try {
      const full = await getKpiData(); // production data with shifts + machines
      return res.json(full);
    } catch (err) {
      console.error('❌ Failed to load production KPI data:', err);
      return res.status(500).json({ error: 'Failed to fetch production KPI data' });
    }
});
  
function getUpdatedMachineData(plyCutter, shift, day, callback) {
    // ✅ Ensure 'day' is valid (use the provided 'day' or default to today)
    if (!day) {
        day = centralDayYMD(); // Central day — no UTC rollover at ~19:00 Austin
    }

    // ✅ Prevent crashes by checking for required parameters
    if (!plyCutter || !shift || !day) {
        console.error(`❌ ERROR: Invalid parameters in getUpdatedMachineData -> plyCutter: ${plyCutter}, shift: ${shift}, day: ${day}`);
        return callback(null);
    }

    const query = `
        SELECT 
            (SELECT COUNT(*) FROM reported_issues WHERE plyCutter = ? AND DATE(CONVERT_TZ(date,'+00:00','America/Chicago')) = ? AND shift = ?) AS issueCount,
            (SELECT prod_value FROM ply_cutter_obj WHERE plyCutter = ? AND shift = ? AND day = ? ORDER BY updated_at DESC LIMIT 1) AS prod_value,
            (SELECT help_requested FROM ply_cutter_obj WHERE plyCutter = ? ORDER BY updated_at DESC LIMIT 1) AS helpRequested
    `;

    db.query(query, [plyCutter, day, shift, plyCutter, shift, day, plyCutter], (err, results) => {
        if (err) {
            console.error(`❌ Error fetching machine data:`, err);
            return callback(null);
        }

        if (!results || results.length === 0) {
            console.warn(`⚠️ No data found for ${plyCutter}, shift ${shift}, day ${day}`);
            return callback({ issueCount: 0, prod_value: 0, helpRequested: 0 });
        }

        const issueCount = results[0].issueCount ?? 0;
        const prod_value = results[0].prod_value ?? 0;
        const helpRequested = results[0].helpRequested ?? 0;

        callback({ issueCount, prod_value, helpRequested });
    });
}

// Fetches all objective and production values for a specific shift.
app.get('/api/get-data', (req, res) => {
  const { shift } = req.query;

  if (!shift) {
    return res.status(400).json({ error: 'Shift is required' });
  }

  const sql = 'SELECT * FROM ply_cutter_obj WHERE shift = ?';
  db.query(sql, [shift], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Error fetching data', details: err.message });
    }

    res.json(results);
  });
});

// Retrieves the production objective for the next shift of a specific ply cutter.
app.get('/api/next-shift-obj', (req, res) => {
    const { plyCutter, day, currentShift } = req.query;

    if (!plyCutter || !day || !currentShift) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    const shiftMap = { shift1: 'shift2', shift2: 'shift3', shift3: 'shift1' };
    const nextShift = shiftMap[currentShift];

    const sql = 'SELECT obj_value FROM ply_cutter_obj WHERE plyCutter = ? AND day = ? AND shift = ?';
    db.query(sql, [plyCutter, day, nextShift], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Error fetching next shift OBJ', details: err.message });
        }
        if (results.length === 0) {
            return res.json({ obj_value: null, message: 'No data found for next shift' });
        }
        res.json({ obj_value: results[0].obj_value });
    });
});

// Retrieves all submitted data (obj/prod/program/status/issues) for a given day (and optional shift).
app.get('/api/get-submitted-data', (req, res) => {
    const { day, shift } = req.query;

    if (!day) {
        return res.status(400).json({ error: 'Day parameter is required' });
    }

    let sql = `
        SELECT 
            p.plyCutter, 
            p.shift, 
            p.obj_value, 
            p.prod_value, 
            p.program, 
            CASE WHEN p.floater = 1 THEN true ELSE false END AS floater,
            CASE WHEN p.trainee = 1 THEN true ELSE false END AS trainee,
            COALESCE(m.status, 'UP') AS status,
            COUNT(r.id) AS issueCount
        FROM ply_cutter_obj p
        LEFT JOIN machine_status m ON p.plyCutter = m.plyCutter
        LEFT JOIN reported_issues r ON p.plyCutter = r.plyCutter AND DATE(CONVERT_TZ(r.date,'+00:00','America/Chicago')) = ?
    `;

    const params = [day];

    if (shift) {
        sql += " WHERE p.day = ? AND p.shift = ?";
        params.push(day, shift);
    } else {
        sql += " WHERE p.day = ?";
        params.push(day);
    }

    sql += `
        GROUP BY 
            p.plyCutter, p.shift, p.obj_value, p.prod_value, 
            p.program, p.floater, p.trainee, m.status
    `;

    db.query(sql, params, (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ 
                error: 'Error fetching submitted data', 
                details: err.message 
            });
        }

        res.json(results);
    });
});

// Gets the objective and program for a specific ply cutter on a given day and shift.
app.get('/api/obj', (req, res) => {
    const { plyCutter, day, shift } = req.query;

    if (!plyCutter || !day || !shift) {
        console.error('Missing parameters');
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const sql = 'SELECT obj_value, program FROM ply_cutter_obj WHERE plyCutter = ? AND day = ? AND shift = ?';
    db.query(sql, [plyCutter, day, shift], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error', details: err.message });
        }

        if (results.length === 0) {
            console.warn('No matching data found for the given parameters');
            return res.status(404).json({ obj_value: 'N/A', program: null });
        }

        res.json(results[0]);
    });
});

// Submits a reported issue (type, comment, downtime) for a given ply cutter.
app.post('/api/report-issue', (req, res) => {
    const { plyCutter, date, shift, issue_type, comment, downtime } = req.body;

    if (!plyCutter || !date || !shift || !issue_type || !downtime) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Austin day (YYYY-MM-DD) dérivé du timestamp `date`
    const day = (() => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(date));
    const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${m.year}-${m.month}-${m.day}`;
    })();
    const insertIssueQuery = `
        INSERT INTO reported_issues (plyCutter, date, shift, issue_type, comment, downtime)
        VALUES (?, ?, ?, ?, ?, ?);
    `;

    db.query(insertIssueQuery, [plyCutter, date, shift, issue_type, comment, downtime], (err, result) => {
        if (err) {
            console.error('❌ Database error:', err);
            return res.status(500).json({ error: 'Failed to save issue', details: err.message });
        }

        db.query(
            `SELECT COUNT(*) AS issueCount FROM reported_issues WHERE plyCutter = ? AND DATE(CONVERT_TZ(date,'+00:00','America/Chicago')) = ? AND shift = ?`,
            [plyCutter, day, shift],
            (countErr, countResults) => {
                if (countErr) {
                    console.error('❌ Error fetching updated issue count:', countErr);
                    return;
                }
        
                const newIssueCount = countResults[0]?.issueCount || 0;
                console.log(`✅ Updated issue count for ${plyCutter}, Shift=${shift}, Day=${day}: ${newIssueCount}`);
        
                // 🔥 Ensure the latest issue count is used when sending updates
                db.query(
                    `SELECT obj_value, prod_value, program, help_requested FROM ply_cutter_obj WHERE plyCutter = ? AND shift = ? AND day = ?`,
                    [plyCutter, shift, day],
                    (fetchErr, results) => {
                        if (fetchErr) {
                            console.error('❌ Fetch error after reporting issue:', fetchErr);
                            return;
                        }
        
                        const obj_value = results.length > 0 ? results[0].obj_value : 0;
                        const prod_value = results.length > 0 ? results[0].prod_value : 0;
                        const program = results.length > 0 ? results[0].program || "N/A" : "N/A";
                        const helpRequested = results.length > 0 ? results[0].help_requested : 0;
        
                        console.log(`📡 Emitting update AFTER issue report: PC=${plyCutter}, OBJ=${obj_value}, PROD=${prod_value}, PROGRAM=${program}, ISSUES=${newIssueCount}`);
        
                        io.emit('machineDataUpdated', { 
                            plyCutter, 
                            obj_value, 
                            prod_value, 
                            program, 
                            helpRequested,
                            issueCount: newIssueCount,  // ✅ Now correctly updated
                            shift, 
                            day 
                        });
                    }
                );
            }
        );
        
        

        console.log(`✅ Issue reported for PC=${plyCutter}, Shift=${shift}, Type=${issue_type}`);

        // ✅ Fetch all necessary data in one query
        const query = `
            SELECT 
                obj_value, 
                prod_value, 
                program, 
                help_requested,
                (SELECT COUNT(*) FROM reported_issues WHERE plyCutter = ? AND DATE(CONVERT_TZ(date,'+00:00','America/Chicago')) = ? AND shift = ?) AS issueCount
            FROM ply_cutter_obj
            WHERE plyCutter = ? AND shift = ? AND day = ?
            ORDER BY updated_at DESC
            LIMIT 1;
            `;

      
        db.query(query, [plyCutter, day, shift, plyCutter, shift, day], (err, results) => {
            if (err) {
                console.error('❌ Error fetching machine data:', err);
                return res.status(500).json({ error: 'Failed to fetch updated machine data', details: err.message });
            }
        
            if (results.length === 0) {
                console.warn(`⚠️ No matching data found for ${plyCutter}, Shift=${shift}, Day=${date}. Attempting to recover last known values.`);
        
                // 🔥 Essaye de récupérer la dernière valeur connue au lieu de tout remettre à zéro
                db.query(
                `SELECT 
                    obj_value, 
                    prod_value, 
                    program, 
                    help_requested, 
                    (SELECT COUNT(*) FROM reported_issues WHERE plyCutter = ? AND DATE(CONVERT_TZ(date,'+00:00','America/Chicago')) = ? AND shift = ?) AS issueCount
                FROM ply_cutter_obj 
                WHERE plyCutter = ? 
                ORDER BY updated_at DESC 
                LIMIT 1;`,
                [plyCutter, day, shift, plyCutter],
                    (retryErr, retryResults) => {
                        if (retryErr) {
                            console.error('❌ Retry query failed:', retryErr);
                            return;
                        }
                
                        if (retryResults.length > 0) {
                            console.log("🛠️ DEBUG: Recovery Query Results:", retryResults);
                
                            io.emit('machineDataUpdated', { 
                                plyCutter, 
                                obj_value: retryResults[0].obj_value || 0, 
                                prod_value: retryResults[0].prod_value || 0, 
                                program: retryResults[0].program || "N/A", 
                                helpRequested: retryResults[0].help_requested || 0,
                                issueCount: retryResults[0].issueCount || 0,  // ✅ Now correctly counts issues
                                shift, 
                                day 
                            });
                        } else {
                            console.error('❌ No backup data found for plyCutter:', plyCutter);
                        }
                    }
                );
                
            } else {
                console.log("🟢 Query Results After Issue Report:", results);
        
                io.emit('machineDataUpdated', { 
                    plyCutter, 
                    obj_value: results[0].obj_value || 0, 
                    prod_value: results[0].prod_value || 0, 
                    program: results[0].program || "N/A", 
                    helpRequested: results[0].help_requested || 0,
                    issueCount: results[0].issueCount || 0, 
                    shift, 
                    day 
                });
            }
    });
    
        db.query(
            `SELECT 
                obj_value, 
                prod_value, 
                program, 
                (SELECT COUNT(*) FROM reported_issues WHERE plyCutter = ? AND DATE(CONVERT_TZ(date,'+00:00','America/Chicago')) = ? AND shift = ?) AS issueCount
            FROM ply_cutter_obj
            WHERE plyCutter = ? AND shift = ? AND day = ?
            ORDER BY updated_at DESC
            LIMIT 1;`,
            [plyCutter, day, shift, plyCutter, shift, day],
            (fetchErr, results) => {
                if (fetchErr) {
                    console.error('❌ Fetch error after reporting issue:', fetchErr);
                    return;
                }
                console.log("🛠️ DEBUG: Data in ply_cutter_obj after issue insert:", results);
            }
        );

    db.query(query, [plyCutter, day, shift, plyCutter, shift, day], (err, results) => {
            if (err) {
                console.error('❌ Error fetching machine data:', err);
                return res.status(500).json({ error: 'Failed to fetch updated machine data', details: err.message });
            }
        
            //console.log("🟢 Query Results After Issue Report:", results);
        
            if (results.length === 0) {
                console.warn(`⚠️ No matching data found. Fetching latest data from DB...`);
            
                const retryQuery = `
                    SELECT obj_value, prod_value, program, 
                    (SELECT COUNT(*) FROM reported_issues WHERE plyCutter = ? AND DATE(CONVERT_TZ(date,'+00:00','America/Chicago')) = ? AND shift = ?) AS issueCount
                    FROM ply_cutter_obj WHERE plyCutter = ? AND shift = ? AND day = ?
                    ORDER BY updated_at DESC LIMIT 1;
                `;
            
                db.query(retryQuery, [plyCutter, day, shift, plyCutter, shift, day], (retryErr, retryResults) => {
                    if (retryErr) {
                        console.error('❌ Retry query failed:', retryErr);
                        return;
                    }
            
                    //console.log("🟢 Retry Query Results:", retryResults);
            
                    if (retryResults.length > 0) {
                        io.emit('machineDataUpdated', { 
                            plyCutter, 
                            obj_value: retryResults[0].obj_value || 0, 
                            prod_value: retryResults[0].prod_value || 0, 
                            program: retryResults[0].program || "N/A", 
                            issue_count: retryResults[0].issueCount || 0, 
                            shift, 
                            day 
                        });     
                    }
                });
            }
            
        
            const obj_value = results.length > 0 ? results[0].obj_value : 0;
            const prod_value = results.length > 0 ? results[0].prod_value : 0;
            const program = results.length > 0 ? results[0].program || "N/A" : "N/A";
            const issue_count = results.length > 0 ? results[0].issueCount || 0 : 0;
            const help_requested = results.length > 0 ? results[0].help_requested : 0;
        
            //console.log(`📡 Emitting update AFTER issue report: PC=${plyCutter}, OBJ=${obj_value}, PROD=${prod_value}, PROGRAM=${program}, ISSUES=${issue_count}`);
        
            io.emit('machineDataUpdated', { 
                plyCutter, 
                obj_value, 
                prod_value, 
                program, 
                issue_count, 
                help_requested, 
                shift, 
                day 
            });
            io.emit('objUpdated', { plyCutter, obj_value });

        
            res.status(200).json({ 
                message: 'Issue submitted successfully', 
                issueId: result.insertId, 
                issue_count, 
                obj_value, 
                prod_value, 
                program 
            });
        });
        
    });
});

// Fetches all issues for a specific ply cutter, shift, and day (used in live status and production screen).
app.get('/api/get-issues', (req, res) => {
    const { plyCutter, day, shift } = req.query;

    if (!plyCutter || !day || !shift) {
        return res.status(400).json({ error: 'Missing required parameters', issues: [] });
    }

    const sql = `
        SELECT issue_type, comment, downtime 
        FROM reported_issues 
        WHERE plyCutter = ? AND DATE(CONVERT_TZ(date,'+00:00','America/Chicago')) = ? AND shift = ?
        ORDER BY date DESC
    `;
    db.query(sql, [plyCutter, day, shift], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Error fetching issues', issues: [] });
        }

        res.json({ issues: results || [] });
    });
});

// Retrieves issue logs filtered by ply cutter, day, shift, and issue type for Pareto chart analysis.
// GET /api/get-pareto-data
// Purpose: return reported_issues filtered by machine, shift, issue type,
// and either a specific local day (America/Chicago) OR a local date range.
// Notes for the reader:
// - The column `date` is stored in UTC in DB. We convert it to America/Chicago
//   before extracting the calendar day to compare against user-provided Y-M-D.
// - If `day` is provided (YYYY-MM-DD), it TAKES PRIORITY over the range.
// - `startDate`/`endDate` are inclusive and must be YYYY-MM-DD (local Austin day).
app.get('/api/get-pareto-data', (req, res) => {
  // Read all supported query params
  let {
    plyCutter,
    day,
    shift,
    issueType,
    startDate,
    endDate
  } = req.query;

  // Normalize common "ALL" or empty values to null for easier branching
  const norm = v => (v && v !== 'ALL' && v !== '' ? v : null);
  plyCutter = norm(plyCutter);
  day       = norm(day);
  shift     = norm(shift);
  issueType = norm(issueType);
  startDate = norm(startDate);
  endDate   = norm(endDate);

  // Base query
    let query = `
    SELECT 
        \`date\`,
        plyCutter,
        issue_type,
        comment,
        downtime,
        \`shift\` AS shift
    FROM reported_issues
    WHERE 1=1
    `;
  const params = [];

  // Filter by machine if provided
  if (plyCutter) {
    query += " AND plyCutter = ?";
    params.push(plyCutter);
  }

  // Filter by shift if provided
    if (shift) { 
    query += " AND `shift` = ?"; 
    params.push(shift); 
    }

  // Filter by issue type if provided
  if (issueType) {
    query += " AND issue_type = ?";
    params.push(issueType);
  }

  // Date filtering (local Austin time)
  // If `day` is present, it overrides the range and matches that exact local day.
  if (day) {
    query += " AND DATE(CONVERT_TZ(`date`, '+00:00', 'America/Chicago')) = ?";
    params.push(day);
  } else {
    // Inclusive range handling
    // If both provided → BETWEEN; otherwise apply single-sided bound.
    if (startDate && endDate) {
      query += " AND DATE(CONVERT_TZ(`date`, '+00:00', 'America/Chicago')) BETWEEN ? AND ?";
      params.push(startDate, endDate);
    } else if (startDate) {
      query += " AND DATE(CONVERT_TZ(`date`, '+00:00', 'America/Chicago')) >= ?";
      params.push(startDate);
    } else if (endDate) {
      query += " AND DATE(CONVERT_TZ(`date`, '+00:00', 'America/Chicago')) <= ?";
      params.push(endDate);
    }
  }

  // Sort by most recent first
  query += " ORDER BY `date` DESC";

  // Debug log (safe: shows the final SQL with parameters array)
  console.log("[/api/get-pareto-data] SQL:", query, params);

  // Execute
  db.query(query, params, (err, results) => {
    if (err) {
      console.error("[/api/get-pareto-data] Database error:", err);
      return res.status(500).json({ error: "Database error", details: err });
    }
    return res.json({ paretoData: results });
  });
});

// Updates the production count for a given ply cutter / shift for **Austin local day**.
// IMPORTANT:
// - We DO NOT trust the client's `day` for writes. We always compute the day server-side
//   in America/Chicago to avoid midnight-UTC rollovers counting into the wrong date.
// - If `delta` is provided (number), we perform an atomic increment in SQL: prod_value = prod_value + delta
// - Otherwise, if `prod_value` is provided, we set the value directly.
// - We ensure the (plyCutter, shift, day) row exists before updating (safe with multiple tabs).
// - After updating, we read back the fresh row, broadcast via WebSocket, and return it.
app.post('/api/update-prod', (req, res) => {
  const { plyCutter, shift, day: dayFromClient, prod_value, delta } = req.body;

  // --- 1) Input validation (we no longer require `day` from client) ---
  if (!plyCutter || !shift || (prod_value === undefined && typeof delta !== 'number')) {
    return res.status(400).json({
      error: "Missing required fields (need plyCutter, shift, and either delta or prod_value)"
    });
  }

  // Coerce and validate numbers
  const shiftNum = Number(shift);
  const deltaNum = (typeof delta === 'number') ? Number(delta) : undefined;
  const prodValueNum = (prod_value !== undefined) ? Number(prod_value) : undefined;

  if (!Number.isFinite(shiftNum)) return res.status(400).json({ error: "Invalid shift number" });
  if (deltaNum === undefined && prodValueNum === undefined)
    return res.status(400).json({ error: "Either delta (number) or prod_value must be provided" });
  if (deltaNum !== undefined && !Number.isFinite(deltaNum))
    return res.status(400).json({ error: "Invalid delta number" });
  if (prodValueNum !== undefined && !Number.isFinite(prodValueNum))
    return res.status(400).json({ error: "Invalid prod_value number" });

  // --- 2) Compute Austin (America/Chicago) day server-side (source of truth) ---
  // Requires a helper centralDayYMD(). If not present, fallback builds it inline.
  const computeCentralDay = () => {
    if (typeof centralDayYMD === 'function') return centralDayYMD();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${m.year}-${m.month}-${m.day}`;
  };
  const dayUsed = computeCentralDay();

  // Log any discrepancy between client-provided day and server-computed Austin day
  if (dayFromClient && dayFromClient !== dayUsed) {
    console.warn('[UPDATE PROD] Client day differs from server Austin day', {
      plyCutter, shift: shiftNum, dayClient: dayFromClient, dayUsed,
      isoServer: new Date().toISOString()
    });
  }

  // --- 3) Ensure row exists for (plyCutter, shift, dayUsed) ---
  const ensureSql = `
    INSERT INTO ply_cutter_obj (plyCutter, shift, day, obj_value, prod_value, program, help_requested, updated_at)
    SELECT ?, ?, ?, 0, 0, 'N/A', 0, UTC_TIMESTAMP()
    WHERE NOT EXISTS (
      SELECT 1 FROM ply_cutter_obj WHERE plyCutter = ? AND shift = ? AND day = ?
    )
  `;
  db.query(ensureSql, [plyCutter, shiftNum, dayUsed, plyCutter, shiftNum, dayUsed], (ensureErr) => {
    if (ensureErr) {
      console.error('❌ Ensure row error:', ensureErr);
      return res.status(500).json({ error: 'Failed to ensure row exists', details: ensureErr.message });
    }

    // --- 4) Update (atomic increment if delta; otherwise set) ---
    const updateSql = (deltaNum !== undefined)
      ? `
         UPDATE ply_cutter_obj
            SET prod_value = GREATEST(prod_value + ?, 0),
                updated_at = UTC_TIMESTAMP()
          WHERE plyCutter = ? AND shift = ? AND day = ?
        `
      : `
         UPDATE ply_cutter_obj
            SET prod_value = ?,
                updated_at = UTC_TIMESTAMP()
          WHERE plyCutter = ? AND shift = ? AND day = ?
        `;
    const updateParams = (deltaNum !== undefined)
      ? [deltaNum, plyCutter, shiftNum, dayUsed]
      : [prodValueNum, plyCutter, shiftNum, dayUsed];

    db.query(updateSql, updateParams, (updateErr) => {
      if (updateErr) {
        console.error('❌ Update error:', updateErr);
        return res.status(500).json({ error: 'Failed to update production count', details: updateErr.message });
      }

      // --- 5) Read back the fresh row ---
      const readSql = `
        SELECT obj_value, prod_value, program, shift, help_requested, updated_at
          FROM ply_cutter_obj
         WHERE plyCutter = ? AND shift = ? AND day = ?
         LIMIT 1
      `;
      db.query(readSql, [plyCutter, shiftNum, dayUsed], (readErr, rows) => {
        if (readErr) {
          console.error('❌ Read-back error:', readErr);
          return res.status(500).json({ error: 'Failed to read updated values', details: readErr.message });
        }
        if (!rows || rows.length === 0) {
          console.warn(`⚠️ Row not found after update (plyCutter=${plyCutter}, shift=${shiftNum}, day=${dayUsed})`);
          return res.status(404).json({ error: 'Row not found after update' });
        }

        const row = rows[0];
        const payload = {
          plyCutter,
          obj_value: row.obj_value ?? 0,
          prod_value: row.prod_value ?? 0,
          program: row.program ?? 'N/A',
          helpRequested: row.help_requested ?? 0,
          shift: row.shift ?? shiftNum,
          day: dayUsed,
          updated_at_UTC: row.updated_at
        };

        // --- 6) Broadcast to all clients (keep screens in sync) ---
        io.emit('machineDataUpdated', payload);
        io.emit('objUpdated', { plyCutter, obj_value: payload.obj_value });

        // --- 7) Respond with authoritative value and day used ---
        return res.status(200).json({
          message: 'Production updated successfully',
          prod_value: payload.prod_value,
          day: dayUsed
        });
      });
    });
  });
});


// Logs start and end timestamps of help requests to compute response times.
app.post('/api/help-request', async (req, res) => {
    //console.log(" Help request received:", req.body); 

    const { plyCutter, shift, day, start_call, end_call } = req.body;

    if (!plyCutter || !shift || !day || !start_call || !end_call) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const query = `
            INSERT INTO help_requests (plyCutter, shift, request_date, start_call, end_call)
            VALUES (?, ?, ?, ?, ?)
        `;
        await db.promise().query(query, [
            plyCutter,
            shift,
            day,
            start_call.slice(0, 19).replace('T', ' '),
            end_call.slice(0, 19).replace('T', ' ')
          ]);
          
        res.status(200).json({ message: 'Help request recorded successfully' });
    } catch (err) {
        console.error('Error saving help request:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Fetches production count and number of issues for a specific ply cutter, shift, and day.
app.get('/api/get-prod-issues', (req, res) => {
    const { plyCutter, shift, day } = req.query;

    if (!plyCutter || !shift || !day) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    const sql = `
        SELECT prod_value FROM ply_cutter_obj WHERE plyCutter = ? AND shift = ? AND day = ?;
    `;

    db.query(sql, [plyCutter, shift, day], (err, prodResults) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error', details: err.message });
        }

        const prod_value = prodResults.length > 0 ? prodResults[0].prod_value : 0;

        const issuesSql = `
            SELECT COUNT(*) AS issue_count FROM reported_issues 
            WHERE plyCutter = ?  AND DATE(CONVERT_TZ(date,'+00:00','America/Chicago')) = ? AND shift = ?;
        `;

        db.query(issuesSql, [plyCutter, day, shift], (err, issueResults) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error', details: err.message });
            }

            const issueCount = issueResults.length > 0 ? issueResults[0].issue_count : 0;

            //console.log(` Issues found for plyCutter: ${plyCutter}, Shift: ${shift}, Day: ${day} => Count: ${issueCount}`);

            res.json({ prod_value, issueCount });
        });
    });
});

// API to update shift when it changes
app.post('/api/update-shift', (req, res) => {
    const { shift } = req.body;

    if (!shift) {
        return res.status(400).json({ error: 'Missing shift data' });
    }

    const updateQuery = `
        UPDATE shift_tracking 
        SET shift = ? 
        WHERE id = 1
    `;

    db.query(updateQuery, [shift], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to update shift' });
        }
        io.emit("shiftChanged", { shift }); // Broadcast shift update
        res.status(200).json({ message: 'Shift updated successfully', shift })
    });
});

// API to fetch last stored shift on reload
app.get('/api/get-current-shift', (req, res) => {
    const sql = `SELECT shift FROM shift_tracking WHERE id = 1`;

    db.query(sql, (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to retrieve shift' });
        }

        if (results.length === 0) {
            return res.json({ shift: 1 }); // Default to shift 1
        }

        res.json({ shift: results[0].shift });
    });
});

// to feth all the ply cutter data at the same time (real_time_status to fetch all when reload)
app.get('/api/get-all-status', (req, res) => {
    const safeDay = req.query.day || centralDayYMD();
    const sql = `
        SELECT 
            m.plyCutter, 
            m.status, 
            m.updated_at,
            COALESCE(p.obj_value, 0) AS obj_value,
            COALESCE(p.help_requested, 0) AS help_requested
        FROM machine_status m
        LEFT JOIN ply_cutter_obj p 
            ON m.plyCutter = p.plyCutter 
            AND p.day = ?
            AND p.shift = (SELECT shift FROM shift_tracking WHERE id = 1)
    `;

    db.query(sql, [safeDay], (err, results) => {
        if (err) {
            console.error("❌ Database error fetching all machine statuses:", err);
            return res.status(500).json({ error: "Failed to retrieve all machine statuses", details: err.message });
        }

        res.json(results);
    });
});


// updates status and broadcasts it (maintenance_screen + real time push on real_time_status)
app.post('/update_status', (req, res) => {
    const { plyCutter, status } = req.body;

    if (!plyCutter || !status) {
        return res.status(400).json({ error: "Missing plyCutter or status" });
    }

    const query = `
        INSERT INTO machine_status (plyCutter, status, updated_at)
        VALUES (?, ?, NOW()) 
        ON DUPLICATE KEY UPDATE status = VALUES(status), updated_at = NOW();
    `;

    db.query(query, [plyCutter, status], (err, result) => {
        if (err) {
            console.error("❌ Database update failed:", err);
            return res.status(500).json({ error: "Failed to update status" });
        }
        console.log(`✅ Machine ${plyCutter} status updated to ${status}`);

        // ✅ Broadcast updated status to all clients
        io.emit('updateMachineStatus', [{ plyCutter, status }]);
        
        res.json({ message: "Status updated successfully", plyCutter, status });
    });
});


// Inserts or updates a maintenance log (start/end time, reason, work order, comment).
app.post('/insert_log', (req, res) => {
    //console.log(" Received request at /insert_log:", req.body);

    const logs = req.body.logs;  // Extract the logs array
    if (!logs || logs.length === 0) {
        return res.status(400).json({ error: "Missing logs array" });
    }

    const { plyCutter, reason, work_order, comment } = logs[0];
    const start_time = logs[0].start_time || getAustinTimestamp();
    const end_time = logs[0].end_time || null;    
    
    if (!plyCutter || !start_time) {
        console.error("❌ Missing required fields:", { plyCutter, start_time });
        return res.status(400).json({ error: "Missing required fields" });
    }

    const checkSql = `SELECT * FROM maintenance_logs WHERE plyCutter = ? AND start_time = ?`;
    
    db.query(checkSql, [plyCutter, start_time], (checkErr, results) => {
        if (checkErr) {
            console.error("❌ SQL Error: ", checkErr.sqlMessage);
            return res.status(500).json({ error: "Failed to check existing log", details: checkErr.sqlMessage });
        }

        if (results.length > 0) {
            // Log exists -> UPDATE instead of inserting duplicate
            const updateSql = `
                UPDATE maintenance_logs 
                SET end_time = ?, reason = ?, work_order = ?, comment = ?
                WHERE plyCutter = ? AND start_time = ?;
            `;
            
            db.query(updateSql, [
                end_time || null,
                reason || null,
                work_order && work_order.trim() !== "" ? work_order : null,
                comment && comment.trim() !== "" ? comment : null,
                plyCutter,
                start_time
            ], (updateErr, result) => {
                if (updateErr) {
                    console.error("❌ SQL Update Error: ", updateErr.sqlMessage);
                    return res.status(500).json({ error: "Failed to update maintenance log", details: updateErr.sqlMessage });
                }
                res.json({ message: "Maintenance log updated", affectedRows: result.affectedRows });
            });
        } else {
            // Log does not exist -> INSERT new log
            const insertSql = `
                INSERT INTO maintenance_logs (plyCutter, start_time, end_time, reason, work_order, comment) 
                VALUES (?, ?, ?, ?, ?, ?);
            `;

            db.query(insertSql, [
                plyCutter,
                start_time,
                end_time || null,
                reason || null,
                work_order && work_order.trim() !== "" ? work_order : null,
                comment && comment.trim() !== "" ? comment : null
            ], (insertErr, result) => {
                if (insertErr) {
                    console.error("❌ SQL Insert Error: ", insertErr.sqlMessage);
                    return res.status(500).json({ error: "Failed to insert maintenance log", details: insertErr.sqlMessage });
                }
                res.json({ message: "Maintenance log inserted", logId: result.insertId });
            });
        }
    });
});

// Retrieves active and recent maintenance logs for a specific ply cutter.
app.get('/get_logs', (req, res) => {
    const { plyCutter } = req.query;

    if (!plyCutter) {
        return res.status(400).json({ error: "Missing plyCutter parameter" });
    }

    const activeLogQuery = `
        SELECT 
            id,
            DATE_FORMAT(CONVERT_TZ(start_time, '+00:00', '+00:00'), '%Y-%m-%dT%H:%i:%sZ') AS start_time,
            DATE_FORMAT(CONVERT_TZ(end_time, '+00:00', '+00:00'), '%Y-%m-%dT%H:%i:%sZ') AS end_time,
            duration, reason, work_order, comment 
        FROM maintenance_logs 
        WHERE plyCutter = ? AND start_time IS NOT NULL AND end_time IS NULL 
        ORDER BY start_time DESC 
        LIMIT 1
    `;


    const historyLogsQuery = `
        SELECT 
            id,
            DATE_FORMAT(CONVERT_TZ(start_time, '+00:00', '+00:00'), '%Y-%m-%dT%H:%i:%sZ') AS start_time,
            DATE_FORMAT(CONVERT_TZ(end_time, '+00:00', '+00:00'), '%Y-%m-%dT%H:%i:%sZ') AS end_time,
            duration, reason, work_order, comment 
        FROM maintenance_logs 
        WHERE plyCutter = ? AND start_time IS NOT NULL AND end_time IS NOT NULL
        ORDER BY start_time DESC 
        LIMIT 3
    `;


    db.query(activeLogQuery, [plyCutter], (errActive, activeResults) => {
        if (errActive) {
            console.error("❌ Failed to fetch active log:", errActive);
            return res.status(500).json({ error: "Database error (active log)" });
        }

        db.query(historyLogsQuery, [plyCutter], (errHistory, historyResults) => {
            if (errHistory) {
                console.error("❌ Failed to fetch history logs:", errHistory);
                return res.status(500).json({ error: "Database error (history logs)" });
            }

            const formatLog = (log) => ({
                id: log.id,
                start_time: log.start_time,
                end_time: log.end_time,
                duration: log.duration || "",
                reason: log.reason || "Not Specified",
                work_order: log.work_order || "",
                comment: log.comment || ""
            });

            const response = {
                activeLog: activeResults.length > 0 ? formatLog(activeResults[0]) : null,
                historyLogs: historyResults.map(formatLog)
            };

            // 🔍 Log what we’re sending and when
            console.log(`📤 [/get_logs] Responding at ${new Date().toISOString()}`);
            console.log("📄 Result:", response);

            res.json(response);
        });

    });
});

// --- helper timezone and sql format
function ts(v) {
  if (v == null || v === '') return null;

  // Objet Date -> "YYYY-MM-DD HH:mm:ss" (UTC)
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    const pad = n => String(n).padStart(2,'0');
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth()+1)}-${pad(v.getUTCDate())} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`;
  }

  const s = String(v).trim();

  // Déjà MySQL "YYYY-MM-DD HH:mm:ss"
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;

  // ISO "YYYY-MM-DDTHH:mm:ss(.sss)?Z"
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s))
    return s.slice(0,19).replace('T',' ');

  // MySQL avec millisecondes
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+$/.test(s))
    return s.split('.')[0];

  // Epoch ms/sec
  if (/^\d{13}$/.test(s)) return ts(new Date(Number(s)));
  if (/^\d{10}$/.test(s)) return ts(new Date(Number(s)*1000));

  // Tentative de parse « large »
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : ts(d);
}

// Updates existing maintenance logs in batch (based on log IDs).

app.post('/update_log', (req, res) => {
    //console.log(" Received request at /update_log:", req.body);

    const logs = req.body.logs;
    if (!logs || logs.length === 0) {
        return res.status(400).json({ error: "No logs provided for update." });
    }

       let updatePromises = logs.map(log => {
        return new Promise((resolve, reject) => {
            const sql = `
               UPDATE maintenance_logs
               SET 
                 start_time = COALESCE(?, start_time),   -- ne change pas si NULL
                 end_time   = ?, 
                 reason     = ?, 
                 work_order = ?, 
                 comment    = ?
               WHERE id = ?;
             `;

            const params = [
                ts(log.start_time),
                ts(log.end_time),
                log.reason || null,
                log.work_order || null,
                log.comment || null,
                log.id
            ];       
            

            db.query(sql, params, (err, result) => {
                if (err) {
                    console.error("❌ SQL Update Error: ", err.sqlMessage);
                    reject(err);
                } else {
                    console.log(`📝 [/update_log] Updated at ${new Date().toISOString()}:`, log);
                    resolve(result);
                }
            });

        });
    });

    Promise.all(updatePromises)
        .then(results => res.json({ message: "Logs updated successfully", affectedRows: results.length }))
        .catch(err => res.status(500).json({ error: "Failed to update logs", details: err }));
});

// Fetches the most recent status (UP/DOWN) of a specific ply cutter.
app.get('/get_machine_status', (req, res) => {
    const { plyCutter } = req.query;

    if (!plyCutter) {
        return res.status(400).json({ error: "Missing plyCutter parameter" });
    }

    const query = `
        SELECT status FROM machine_status 
        WHERE plyCutter = ? 
        ORDER BY updated_at DESC LIMIT 1
    `;

    db.query(query, [plyCutter], (err, results) => {
        if (err) {
            console.error("❌ Failed to fetch machine status:", err);
            return res.status(500).json({ error: "Database error" });
        }

        const status = results.length > 0 ? results[0].status : 'UP'; // Default to UP
        res.json({ status });
    });
});

// Deletes a maintenance log by its ID.
app.delete('/delete_log/:id', (req, res) => {
    const logId = req.params.id;
    if (!logId) return res.status(400).json({ error: 'Missing log ID' });

    const deleteSql = 'DELETE FROM maintenance_logs WHERE id = ?';
    db.query(deleteSql, [logId], (err, result) => {
        if (err) {
            console.error('❌ Error deleting log:', err);
            return res.status(500).json({ error: 'Failed to delete log' });
        }

        res.json({ message: 'Log deleted successfully', logId });
    });
});

// Saves monthly defect counts to the KPI yield table.
app.post('/api/quality-data', (req, res) => {
    const defectEntries = req.body;
  
    if (!Array.isArray(defectEntries)) {
      return res.status(400).json({ error: "Invalid data format" });
    }
  
    const sql = `
      INSERT INTO kpi_yield_data (month, defects)
      VALUES ?
      ON DUPLICATE KEY UPDATE defects = VALUES(defects)
    `;
  
    const values = defectEntries.map(entry => [entry.month, entry.defects]);
  
    db.query(sql, [values], (err, result) => {
      if (err) {
        console.error("❌ Failed to save defect data:", err);
        return res.status(500).json({ error: "SQL error" });
      }
  
      //console.log("✅ Defect data saved to SQL.");
      res.status(200).json({ message: "Saved to database!" });
    });
});

// Retrieves monthly defect counts for quality/yield analysis.
app.get('/api/quality-data', (req, res) => {
    db.query("SELECT month, defects FROM kpi_yield_data", (err, rows) => {
      if (err) {
        console.error("❌ Failed to fetch quality data:", err);
        return res.status(500).json({ error: "SQL error" });
      }
      res.json(rows);
    });
});

// Returns maintenance KPIs over a given time range (default: past month).
app.get('/api/maintenance/kpi', async (req, res) => {
    try {
      const range = req.query.range || '1m';
      const data = await getMaintenanceKpiData(range);
      res.json(data);
    } catch (err) {
      console.error('❌ Failed to get maintenance KPI data:', err);
      res.status(500).json({ error: 'Failed to fetch maintenance KPI data' });
    }
});

// Analyse phase in CI
function formatDateForSQL(dateStr) {
const date = new Date(dateStr);
if (isNaN(date.getTime())) {
    throw new Error("Invalid date: " + dateStr);
}
return date.toISOString().slice(0, 19).replace('T', ' ');
}

// Fetches maintenance logs over a date range, optionally filtered by ply cutter.
app.get('/api/maintenance/logs', (req, res) => {
try {
    const { start, end, plyCutter } = req.query;

    if (!start || !end) {
    return res.status(400).json({ error: 'Missing start or end date' });
    }

    const startSQL = formatDateForSQL(start);
    const endSQL = formatDateForSQL(end + 'T23:59:59');

    let sql = `
    SELECT * FROM maintenance_logs
    WHERE start_time >= ? AND start_time <= ?
    `;
    const params = [startSQL, endSQL];

    if (plyCutter && plyCutter !== 'ALL') {
    sql += ` AND plyCutter = ?`;
    params.push(plyCutter);
    }

    sql += ` ORDER BY start_time DESC`;

    db.query(sql, params, (err, results) => {
    if (err) {
        console.error('❌ Error fetching logs:', err);
        return res.status(500).json({ error: 'Database error' });
    }

    res.json({ logs: results });
    });
} catch (e) {
    console.error('❌ Date formatting error:', e.message);
    return res.status(400).json({ error: 'Invalid date format' });
}
});
 
// Start Server
const PORT = process.env.PORT || 8081;
const HOST = process.env.HOST || '0.0.0.0'; // 👈 toutes interfaces

http.listen(PORT, HOST, () => {
  console.log(`✅ Server running on http://${HOST}:${PORT}`);
});
