// Converts any ISO or UTC timestamp string to the corresponding Austin local date (YYYY-MM-DD)
function getAustinDateStringFromISO(isoString) {
  const austinDate = new Date(new Date(isoString).toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return austinDate.toISOString().split("T")[0];
}

// Converts a local time string to UTC ISO
function toUTCFromAustin(localTimeString) {
  const localDate = new Date(localTimeString);
  return new Date(localDate.toLocaleString('en-US', { timeZone: 'UTC' })).toISOString();
}

// Converts a Date or ISO string to MySQL-compatible UTC format: 'YYYY-MM-DD HH:MM:SS'
function toMySQLTimestamp(date = new Date()) {
  return new Date(date).toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = {
  getAustinDateStringFromISO,
  toUTCFromAustin,
  toMySQLTimestamp
};
