const express = require('express');
const app = express();
const http = require('http').createServer(app);
    const io = require('socket.io')(http, {
        cors: {
            origin: "*", // Allow connections from any origin inside your network
            methods: ["GET", "POST"]
        }
    });
    
const mysql = require('mysql2');
const bodyParser = require('body-parser');

// Middleware
app.use(bodyParser.json());
app.use('/images', express.static(__dirname + '/public/images'));
app.use(express.static(__dirname + '/public'));


// MySQL Connection
const pool = mysql.createPool({
    host: '10.0.4.199',
    user: 'paretops_user',
    password: 'paretops_password',
    database: 'paretops',
    timezone: 'America/Chicago',
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0
});

pool.on('error', (err) => {
    console.error('❌ MySQL pool error:', err);
});

    // Keep-alive query to prevent MySQL connection timeout
    setInterval(() => {
        pool.query('SELECT 1', (err) => {
            if (err) console.error('❌ Keep-alive query failed:', err);
            else console.log('✅ Keep-alive query succeeded');
        });
    }, 15 * 60 * 1000); // every 15 minutes

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
        hour12: false
    };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(now);
    const dateParts = {};
    parts.forEach(part => dateParts[part.type] = part.value);
    return `${dateParts.year}-${dateParts.month}-${dateParts.day} ${dateParts.hour}:${dateParts.minute}:${dateParts.second}`;
}


// WebSocket Logic
io.on('connection', (socket) => {
    console.log('🔗 A user connected');

    socket.on("shiftChanged", (data) => {
        console.log(`📢 Shift changed: ${data.shift}`);
        io.emit("shiftChanged", data);
    });

    socket.on('refreshRealTimeStatus', () => {
        pool.query('SELECT plyCutter, status FROM machine_status', (err, results) => {
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
        pool.query(
            `UPDATE ply_cutter_obj SET help_requested = ? WHERE plyCutter = ?`,
            [helpRequested, plyCutter],  
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
    if (password === 'cfantastic') {
        res.sendStatus(200); // Success
    } else {
        res.sendStatus(401); // Unauthorized
    }
});

// Serve the leader dashboard page
app.get('/leader.html', (req, res) => {
    res.sendFile(__dirname + '/public/leader.html');
});


app.get('/production.html', (req, res) => {
    res.sendFile(__dirname + '/public/production.html');
});

app.get('/maintenance.html', (req, res) => {
    res.sendFile(__dirname + '/public/maintenance.html');
});

app.get('/production-setup', (req, res) => {
    res.sendFile(__dirname + '/public/production_plycutter_setup.html');
});

app.get('/real_time_status', (req, res) => {
    res.sendFile(__dirname + '/public/real_time_status.html');
});

app.get('/production_kpi', (req, res) => {
    res.sendFile(__dirname + '/public/production_kpi.html');
});

app.get('/maintenance_kpi', (req, res) => {
    res.sendFile(__dirname + '/public/maintenance_kpi.html');
});

app.get('/pareto', (req, res) => {
    res.sendFile(__dirname + '/public/pareto.html');
});

app.get('/production_screen/:plyCutter', (req, res) => {
    res.sendFile(__dirname + '/public/production_screen.html');
});

app.get('/maintenance_screen/:plyCutter', (req, res) => {
    res.sendFile(__dirname + '/public/maintenance_screen.html');
});

app.get('/contact', (req, res) => {
    res.sendFile(__dirname + '/public/contact.html');
});

app.post('/api/save-data', (req, res) => {
    const { shift, day, data } = req.body;

    if (!shift || !day || !Array.isArray(data)) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    const sql = `
        INSERT INTO ply_cutter_obj (plyCutter, shift, day, obj_value, program, floater, trainee)
        VALUES ? 
        ON DUPLICATE KEY UPDATE 
            obj_value = VALUES(obj_value),
            program = VALUES(program),
            floater = VALUES(floater),
            trainee = VALUES(trainee);
    `;

    const values = data.map(d => [
        d.plyCutter, shift, day, d.output_obj, d.program, d.floater, d.trainee
    ]);


    pool.query(sql, [values], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Failed to save shift data', details: err.message });
        }

        // ✅ Fetch updated values before emitting
        data.forEach(d => {  // ✅ Define 'd' inside forEach loop
            const { plyCutter } = d;  // ✅ Extract plyCutter from the object
            
            pool.query(
                `SELECT 
                    obj_value, 
                    prod_value, 
                    program, 
                    help_requested,
                    (SELECT COUNT(*) FROM reported_issues WHERE plyCutter = ? AND DATE(date) = ? AND shift = ?) AS issueCount
                FROM ply_cutter_obj 
                WHERE plyCutter = ? 
                ORDER BY updated_at DESC 
                LIMIT 1;`,
                [plyCutter, day, shift, plyCutter],  // ✅ Corrected variable reference
                (err, results) => {
                    if (err) {
                        console.error(`❌ Error fetching updated data for ${plyCutter}:`, err);
                        return;
                    }

                    if (results.length > 0) {
                        const { obj_value, prod_value, program, help_requested, issueCount } = results[0];

                        io.emit('machineDataUpdated', { 
                            plyCutter, 
                            obj_value: obj_value || 0, 
                            prod_value: prod_value || 0, 
                            program: program || "N/A", 
                            help_requested: help_requested || 0, 
                            issue_count: issueCount || 0, 
                            shift, 
                            day
                        });                        
                    }
                }
            );
        });

        res.status(200).json({ message: 'Shift data saved successfully', affectedRows: result.affectedRows });

        io.emit('refreshRealTimeStatus');

    });
});



function getUpdatedMachineData(plyCutter, shift, day, callback) {
    // ✅ Ensure 'day' is valid (use the provided 'day' or default to today)
    if (!day) {
        day = new Date().toISOString().split('T')[0]; // Default to today's date if missing
    }

    // ✅ Prevent crashes by checking for required parameters
    if (!plyCutter || !shift || !day) {
        console.error(`❌ ERROR: Invalid parameters in getUpdatedMachineData -> plyCutter: ${plyCutter}, shift: ${shift}, day: ${day}`);
        return callback(null);
    }

    const query = `
        SELECT 
            (SELECT COUNT(*) FROM reported_issues WHERE plyCutter = ? AND DATE(date) = ? AND shift = ?) AS issueCount,
            (SELECT prod_value FROM ply_cutter_obj WHERE plyCutter = ? AND shift = ? AND day = ? ORDER BY updated_at DESC LIMIT 1) AS prod_value,
            (SELECT help_requested FROM ply_cutter_obj WHERE plyCutter = ? ORDER BY updated_at DESC LIMIT 1) AS helpRequested
    `;

    pool.query(query, [plyCutter, day, shift, plyCutter, shift, day, plyCutter], (err, results) => {
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





// API: Get Data
app.get('/api/get-data', (req, res) => {
  const { shift } = req.query;

  if (!shift) {
    return res.status(400).json({ error: 'Shift is required' });
  }

  const sql = 'SELECT * FROM ply_cutter_obj WHERE shift = ?';
  pool.query(sql, [shift], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Error fetching data', details: err.message });
    }

    res.json(results);
  });
});

// API: Fetch Next Shift OBJ
app.get('/api/next-shift-obj', (req, res) => {
    const { plyCutter, day, currentShift } = req.query;

    if (!plyCutter || !day || !currentShift) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    const shiftMap = { shift1: 'shift2', shift2: 'shift3', shift3: 'shift1' };
    const nextShift = shiftMap[currentShift];

    const sql = 'SELECT obj_value FROM ply_cutter_obj WHERE plyCutter = ? AND day = ? AND shift = ?';
    pool.query(sql, [plyCutter, day, nextShift], (err, results) => {
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
        LEFT JOIN reported_issues r ON p.plyCutter = r.plyCutter AND DATE(r.date) = ?
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

    pool.query(sql, params, (err, results) => {
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


app.get('/api/obj', (req, res) => {
    const { plyCutter, day, shift } = req.query;

    if (!plyCutter || !day || !shift) {
        console.error('Missing parameters');
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const sql = 'SELECT obj_value, program FROM ply_cutter_obj WHERE plyCutter = ? AND day = ? AND shift = ?';
    pool.query(sql, [plyCutter, day, shift], (err, results) => {
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

app.post('/api/report-issue', (req, res) => {
    const { plyCutter, date, shift, issue_type, comment, downtime } = req.body;

    if (!plyCutter || !date || !shift || !issue_type || !downtime) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    const day = date;
    const insertIssueQuery = `
        INSERT INTO reported_issues (plyCutter, date, shift, issue_type, comment, downtime)
        VALUES (?, ?, ?, ?, ?, ?);
    `;

    pool.query(insertIssueQuery, [plyCutter, date, shift, issue_type, comment, downtime], (err, result) => {
        if (err) {
            console.error('❌ Database error:', err);
            return res.status(500).json({ error: 'Failed to save issue', details: err.message });
        }

        pool.query(
            `SELECT COUNT(*) AS issueCount FROM reported_issues WHERE plyCutter = ? AND DATE(date) = ? AND shift = ?`,
            [plyCutter, date, shift],
            (countErr, countResults) => {
                if (countErr) {
                    console.error('❌ Error fetching updated issue count:', countErr);
                    return;
                }
        
                const newIssueCount = countResults[0]?.issueCount || 0;
                console.log(`✅ Updated issue count for ${plyCutter}, Shift=${shift}, Day=${date}: ${newIssueCount}`);
        
                // 🔥 Ensure the latest issue count is used when sending updates
                pool.query(
                    `SELECT obj_value, prod_value, program, help_requested FROM ply_cutter_obj WHERE plyCutter = ? AND shift = ? AND day = ?`,
                    [plyCutter, shift, date],
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
                (SELECT COUNT(*) FROM reported_issues WHERE plyCutter = ? AND DATE(date) = ? AND shift = ?) AS issueCount
            FROM ply_cutter_obj
            WHERE plyCutter = ? AND shift = ? AND day = ?
            ORDER BY updated_at DESC
            LIMIT 1;
        `;
    
        
        pool.query(query, [plyCutter, date, shift, plyCutter, shift, date], (err, results) => {
            if (err) {
                console.error('❌ Error fetching machine data:', err);
                return res.status(500).json({ error: 'Failed to fetch updated machine data', details: err.message });
            }
        
            if (results.length === 0) {
                console.warn(`⚠️ No matching data found for ${plyCutter}, Shift=${shift}, Day=${date}. Attempting to recover last known values.`);
        
                // 🔥 Essaye de récupérer la dernière valeur connue au lieu de tout remettre à zéro
                pool.query(
                    `SELECT 
                        obj_value, 
                        prod_value, 
                        program, 
                        help_requested, 
                        (SELECT COUNT(*) FROM reported_issues WHERE plyCutter = ? AND DATE(date) = ? AND shift = ?) AS issueCount
                    FROM ply_cutter_obj 
                    WHERE plyCutter = ? 
                    ORDER BY updated_at DESC 
                    LIMIT 1;`,
                    [plyCutter, date, shift, plyCutter],
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
    
        pool.query(
            `SELECT 
                obj_value, 
                prod_value, 
                program, 
                (SELECT COUNT(*) FROM reported_issues WHERE plyCutter = ? AND DATE(date) = ? AND shift = ?) AS issueCount
            FROM ply_cutter_obj
            WHERE plyCutter = ? AND shift = ? AND day = ?
            ORDER BY updated_at DESC
            LIMIT 1;`,
            [plyCutter, date, shift, plyCutter, shift, date],
            (fetchErr, results) => {
                if (fetchErr) {
                    console.error('❌ Fetch error after reporting issue:', fetchErr);
                    return;
                }
                console.log("🛠️ DEBUG: Data in ply_cutter_obj after issue insert:", results);
            }
        );

        pool.query(query, [plyCutter, date, shift, plyCutter, shift, date], (err, results) => {
            if (err) {
                console.error('❌ Error fetching machine data:', err);
                return res.status(500).json({ error: 'Failed to fetch updated machine data', details: err.message });
            }
        
            console.log("🟢 Query Results After Issue Report:", results);
        
            if (results.length === 0) {
                console.warn(`⚠️ No matching data found. Fetching latest data from DB...`);
            
                const retryQuery = `
                    SELECT obj_value, prod_value, program, 
                    (SELECT COUNT(*) FROM reported_issues WHERE plyCutter = ? AND DATE(date) = ? AND shift = ?) AS issueCount
                    FROM ply_cutter_obj WHERE plyCutter = ? AND shift = ? AND day = ?
                    ORDER BY updated_at DESC LIMIT 1;
                `;
            
                pool.query(retryQuery, [plyCutter, date, shift, plyCutter, shift, date], (retryErr, retryResults) => {
                    if (retryErr) {
                        console.error('❌ Retry query failed:', retryErr);
                        return;
                    }
            
                    console.log("🟢 Retry Query Results:", retryResults);
            
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
        
            console.log(`📡 Emitting update AFTER issue report: PC=${plyCutter}, OBJ=${obj_value}, PROD=${prod_value}, PROGRAM=${program}, ISSUES=${issue_count}`);
        
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





/* Used for production_screen qnd real_time_status*/
app.get('/api/get-issues', (req, res) => {
    const { plyCutter, day, shift } = req.query;

    if (!plyCutter || !day || !shift) {
        return res.status(400).json({ error: 'Missing required parameters', issues: [] });
    }

    const sql = `
        SELECT issue_type, comment, downtime 
        FROM reported_issues 
        WHERE plyCutter = ? AND DATE(date) = ? AND shift = ?
        ORDER BY date DESC
    `;
    pool.query(sql, [plyCutter, day, shift], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Error fetching issues', issues: [] });
        }

        res.json({ issues: results || [] });
    });
});

app.get('/api/get-pareto-data', (req, res) => {
    let { plyCutter, day, shift, issueType } = req.query; // Include issueType in query params

    let query = `
        SELECT date, plyCutter, issue_type, comment, downtime 
        FROM reported_issues 
        WHERE 1=1
    `;
    let params = [];

    if (plyCutter && plyCutter !== "ALL") {
        query += " AND plyCutter = ?";
        params.push(plyCutter);
    }
    if (day && day !== "ALL") {
        query += " AND DATE(date) = ?";
        params.push(day);
    }
    if (shift && shift !== "ALL") {
        query += " AND shift = ?";
        params.push(shift);
    }
    if (issueType && issueType !== "ALL" && issueType !== "") { // 🔥 Fix: Ensure issue type filter works
        query += " AND issue_type = ?";
        params.push(issueType);
    }

    query += " ORDER BY date DESC"; // Sort by most recent

    console.log("Executing SQL:", query, params); // Debugging log

    pool.query(query, params, (err, results) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).json({ error: "Database error", details: err });
        }
        res.json({ paretoData: results });
    });

});


app.post('/api/update-prod', (req, res) => {
    const { plyCutter, shift, day, prod_value } = req.body;

    if (!plyCutter || !shift || !day || prod_value === undefined) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    // ✅ Fetch existing machine data before updating production value
    const query = `
        SELECT obj_value, prod_value, program, shift, help_requested
        FROM ply_cutter_obj
        WHERE plyCutter = ? AND shift = ? AND day = ?
        ORDER BY updated_at DESC
        LIMIT 1;
    `;

    pool.query(query, [plyCutter, shift, day], (err, results) => {
        if (err) {
            console.error(`❌ ERROR executing query for ${plyCutter}:`, err);
            return;
        }

        if (!results || results.length === 0) {
            console.warn(`⚠️ No results found for PC=${plyCutter}, shift=${shift}, day=${day}`);
            return;
        }

        // Extract values
        const obj_value = results[0].obj_value || 0;
        const prevprod_value = results[0].prod_value || 0;
        const program = results[0].program || "N/A";
        const helpRequested = results[0].help_requested || 0;

        // ✅ Update production value in the database
        const updateQuery = `
            UPDATE ply_cutter_obj 
            SET prod_value = ? 
            WHERE plyCutter = ? AND shift = ? AND day = ?;
        `;

        pool.query(updateQuery, [prod_value, plyCutter, shift, day], (updateErr) => {
            if (updateErr) {
                console.error('❌ Database error:', updateErr);
                return res.status(500).json({ error: 'Failed to update production count', details: updateErr.message });
            }

            // ✅ Emit WebSocket update **right after updating the database**
            console.log(`📡 Emitting real-time update: PC=${plyCutter}, OBJ=${obj_value}, PROD=${prod_value}, PROGRAM=${program}, SHIFT=${shift}`);

            io.emit('machineDataUpdated', { 
                plyCutter, 
                obj_value, 
                prod_value, 
                program, 
                helpRequested, 
                shift, 
                day
            });

            // ✅ Send JSON response to confirm update
            res.status(200).json({ 
                message: 'Production updated successfully', 
                prod_value, 
            });
        });
    });
});


app.get('/api/get-prod-issues', (req, res) => {
    const { plyCutter, shift, day } = req.query;

    if (!plyCutter || !shift || !day) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    const sql = `
        SELECT prod_value FROM ply_cutter_obj WHERE plyCutter = ? AND shift = ? AND day = ?;
    `;

    pool.query(sql, [plyCutter, shift, day], (err, prodResults) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Database error', details: err.message });
        }

        const prod_value = prodResults.length > 0 ? prodResults[0].prod_value : 0;

        const issuesSql = `
            SELECT COUNT(*) AS issue_count FROM reported_issues 
            WHERE plyCutter = ? AND DATE(date) = ? AND shift = ?;
        `;

        pool.query(issuesSql, [plyCutter, day, shift], (err, issueResults) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error', details: err.message });
            }

            const issueCount = issueResults.length > 0 ? issueResults[0].issue_count : 0;

            console.log(`🔍 Issues found for plyCutter: ${plyCutter}, Shift: ${shift}, Day: ${day} => Count: ${issueCount}`);

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

    pool.query(updateQuery, [shift], (err, result) => {
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

    pool.query(sql, (err, results) => {
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
    const sql = `
        SELECT 
            m.plyCutter, 
            m.status, 
            COALESCE(p.help_requested, 0) AS help_requested
        FROM machine_status m
        LEFT JOIN ply_cutter_obj p ON m.plyCutter = p.plyCutter
        AND p.day = CURDATE()
    `;

    pool.query(sql, (err, results) => {
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

    pool.query(query, [plyCutter, status], (err, result) => {
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




app.post('/insert_log', (req, res) => {
    console.log("📥 Received request at /insert_log:", req.body);

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
    
    pool.query(checkSql, [plyCutter, start_time], (checkErr, results) => {
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
            
            pool.query(updateSql, [
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

            pool.query(insertSql, [
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

app.get('/get_logs', (req, res) => {
    const { plyCutter } = req.query;

    if (!plyCutter) {
        return res.status(400).json({ error: "Missing plyCutter parameter" });
    }

    const activeLogQuery = `
        SELECT 
            id,  -- Explicitly added ID field
            DATE_FORMAT(start_time, '%Y-%m-%d %H:%i:%s') AS start_time, 
            DATE_FORMAT(end_time, '%Y-%m-%d %H:%i:%s') AS end_time,
            duration, reason, work_order, comment 
        FROM maintenance_logs 
        WHERE plyCutter = ? AND start_time IS NOT NULL AND end_time IS NULL 
        ORDER BY start_time DESC 
        LIMIT 1

    `;

    const historyLogsQuery = `
        SELECT 
            id,  -- Explicitly added ID field
            DATE_FORMAT(start_time, '%Y-%m-%d %H:%i:%s') AS start_time, 
            DATE_FORMAT(end_time, '%Y-%m-%d %H:%i:%s') AS end_time,
            duration, reason, work_order, comment 
        FROM maintenance_logs 
        WHERE plyCutter = ? AND start_time IS NOT NULL AND end_time IS NOT NULL
        ORDER BY start_time DESC 
        LIMIT 3

    `;

    pool.query(activeLogQuery, [plyCutter], (errActive, activeResults) => {
        if (errActive) {
            console.error("❌ Failed to fetch active log:", errActive);
            return res.status(500).json({ error: "Database error (active log)" });
        }

        pool.query(historyLogsQuery, [plyCutter], (errHistory, historyResults) => {
            if (errHistory) {
                console.error("❌ Failed to fetch history logs:", errHistory);
                return res.status(500).json({ error: "Database error (history logs)" });
            }

            // Format to avoid null values
            const formatLog = (log) => ({
                id: log.id, // ✅ Add this line
                start_time: log.start_time,
                end_time: log.end_time,
                duration: log.duration || "",
                reason: log.reason || "Not Specified",
                work_order: log.work_order || "",
                comment: log.comment || ""
            });
            
            
            res.json({
                activeLog: activeResults.length > 0 ? formatLog(activeResults[0]) : null,
                historyLogs: historyResults.map(formatLog)
            });
        });
    });
});



app.post('/update_log', (req, res) => {
    console.log("📥 Received request at /update_log:", req.body);

    const logs = req.body.logs;
    if (!logs || logs.length === 0) {
        return res.status(400).json({ error: "No logs provided for update." });
    }

    let updatePromises = logs.map(log => {
        return new Promise((resolve, reject) => {
            const sql = `
                UPDATE maintenance_logs 
                SET 
                    start_time = ?, 
                    end_time = ?, 
                    reason = ?, 
                    work_order = ?, 
                    comment = ?
                WHERE id = ?;
            `;

            const params = [
                log.start_time || null,
                log.end_time || null,
                log.reason || null,
                log.work_order || null,
                log.comment || null,
                log.id
            ];       
            

            pool.query(sql, params, (err, result) => {
                if (err) {
                    console.error("❌ SQL Update Error: ", err.sqlMessage);
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });
    });

    Promise.all(updatePromises)
        .then(results => res.json({ message: "Logs updated successfully", affectedRows: results.length }))
        .catch(err => res.status(500).json({ error: "Failed to update logs", details: err }));
});


// to fetch the latest machine status
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

    pool.query(query, [plyCutter], (err, results) => {
        if (err) {
            console.error("❌ Failed to fetch machine status:", err);
            return res.status(500).json({ error: "Database error" });
        }

        const status = results.length > 0 ? results[0].status : 'UP'; // Default to UP
        res.json({ status });
    });
});

app.delete('/delete_log/:id', (req, res) => {
    const logId = req.params.id;
    if (!logId) return res.status(400).json({ error: 'Missing log ID' });

    const deleteSql = 'DELETE FROM maintenance_logs WHERE id = ?';
    pool.query(deleteSql, [logId], (err, result) => {
        if (err) {
            console.error('❌ Error deleting log:', err);
            return res.status(500).json({ error: 'Failed to delete log' });
        }

        res.json({ message: 'Log deleted successfully', logId });
    });
});

// Start Server
const port = process.env.PORT || 3000;

http.listen(port,'0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
