const mysql = require('mysql2');

// MySQL connection configuration
const pool = mysql.createPool({
    host: 'localhost', // MySQL server address (default: localhost)
    user: 'lean_user',      // MySQL username (default: root)
    password: 'lean_password', // Your MySQL password
    database: 'lean_project',   // Name of your database
    timezone: process.env.MYSQL_TIMEZONE || 'Z'

});

// Export the connection to use it elsewhere
module.exports = pool.promise();
