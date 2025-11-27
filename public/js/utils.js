/* ============================================================================
   TIME & DATE UTILITIES — AUSTIN-SAFE (America/Chicago) + DST ROBUST
   ----------------------------------------------------------------------------
   Why this exists:
   - Avoid the classic "7 pm Austin = 00:00 UTC" rollover bug.
   - Never derive a *local day* via toISOString() (which is UTC-based).
   - Convert between wall-time (Austin) and UTC reliably, including DST.
   --------------------------------------------------------------------------*/

/**
 * Converts a UTC timestamp string to Austin local time in 12-hour format with AM/PM.
 *
 * Accepts either:
 *   - ISO UTC strings like "2025-05-04T18:30:00Z"
 *   - MySQL-style UTC strings "YYYY-MM-DD HH:MM:SS" (we treat as UTC and normalize)
 *
 * Returns a human-readable Austin-local string (MM/DD/YYYY, hh:mm:ss AM/PM).
 */
function formatToAustinTime12h(datetimeString) {
  if (!datetimeString) return '';

  // Normalize MySQL "YYYY-MM-DD HH:MM:SS" → ISO UTC "YYYY-MM-DDTHH:MM:SSZ"
  // We add a 'Z' to tell the Date constructor it's UTC, not local browser time.
  let iso = datetimeString;
  if (!iso.endsWith('Z') && iso.includes(' ')) {
    iso = iso.replace(' ', 'T') + 'Z';
  }

  // Interpret as a UTC instant.
  const utc = new Date(iso);

  // Format that instant as America/Chicago (Austin) local time — DST handled by Intl.
  return utc.toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}


/**
 * Formats all elements that declare a [data-timestamp] attribute in the DOM.
 * Example markup:
 *   <span data-timestamp="2025-05-04T18:30:00Z"></span>
 *
 * We keep the same function name and behavior, but rely on the fixed formatter above.
 */
function formatAllTimestamps() {
  document.querySelectorAll('[data-timestamp]').forEach(el => {
    const raw = el.getAttribute('data-timestamp');
    el.textContent = formatToAustinTime12h(raw);
  });
}

// Auto-run formatting after initial HTML is parsed.
document.addEventListener('DOMContentLoaded', formatAllTimestamps);


/* ----------------------------------------------------------------------------
   AUSTIN WALL-TIME → UTC ISO
   ----------------------------------------------------------------------------
   We need to convert *Austin wall time* (what people type/select) into UTC for
   storage. The browser's local timezone might NOT be Austin, so we CANNOT rely
   on "new Date(localString).toISOString()".
   Instead, we:
     1) Parse the wall-time string to components (Y-M-D h:m:s).
     2) Create a "guess" UTC from those components.
     3) Compute the America/Chicago offset at that instant via Intl.
     4) Refine once more to be robust near DST transitions.
---------------------------------------------------------------------------- */

/**
 * Internal helper: parse basic wall-time strings into components.
 * Supported formats:
 *   - "MM/DD/YYYY hh:mm AM/PM" (optional :ss)
 *   - "YYYY-MM-DD HH:MM" (24h, optional :SS)
 */
function _parseLocalWallTime(input) {
  input = String(input || '').trim();

  // US 12h pattern: MM/DD/YYYY hh:mm[:ss] AM/PM
  let m = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (m) {
    let [, mm, dd, yyyy, hh, mi, ss = '0', ap] = m;
    let h = parseInt(hh, 10);
    if (/pm/i.test(ap) && h !== 12) h += 12; // 1pm..11pm → 13..23
    if (/am/i.test(ap) && h === 12) h = 0;   // 12am → 00
    return { y: +yyyy, M: +mm, d: +dd, h, mi: +mi, s: +ss };
  }

  // ISO-like 24h pattern: YYYY-MM-DD HH:MM[:SS]
  m = input.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [, yyyy, mm, dd, hh, mi, ss = '0'] = m;
    return { y: +yyyy, M: +mm, d: +dd, h: +hh, mi: +mi, s: +ss };
  }

  throw new Error('Unrecognized time format. Use "MM/DD/YYYY hh:mm AM/PM" or "YYYY-MM-DD HH:MM".');
}

/**
 * Internal helper: get the timezone offset (in ms) for a given UTC instant
 * when viewed in a specific IANA timezone. This uses Intl to include DST rules.
 *
 * offset = local_ms - utc_ms
 */
function _getTimeZoneOffsetMs(timeZone, utcMillis) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });

  // Format the UTC instant *as if it were local* in the requested tz...
  const parts = dtf.formatToParts(new Date(utcMillis));
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));

  // ...then rebuild that "local" timestamp as a UTC ms value.
  const asIfLocalUTC = Date.UTC(
    +map.year, +map.month - 1, +map.day,
    +map.hour, +map.minute, +map.second
  );

  // The difference between that and the original UTC instant is the tz offset.
  return asIfLocalUTC - utcMillis;
}

/**
 * Converts an Austin-local wall-time string to a UTC ISO string.
 * Keeps original function name for drop-in compatibility.
 *
 * Examples:
 *   toUTCFromAustin("05/04/2025 06:30 PM") → "2025-05-04T23:30:00.000Z" (if CDT)
 *   toUTCFromAustin("2025-05-04 18:30")   → "2025-05-04T23:30:00.000Z" (if CDT)
 */
function toUTCFromAustin(localTimeString) {
  const { y, M, d, h, mi, s } = _parseLocalWallTime(localTimeString);

  // First guess: interpret the Austin wall-time as if it were UTC.
  // (We will correct by the actual tz offset next.)
  let guessUTC = Date.UTC(y, M - 1, d, h, mi, s);

  // Compute tz offset for America/Chicago at that instant and adjust.
  let offset = _getTimeZoneOffsetMs('America/Chicago', guessUTC);
  let trueUTC = guessUTC - offset;

  // One refinement near DST edges.
  offset = _getTimeZoneOffsetMs('America/Chicago', trueUTC);
  trueUTC = guessUTC - offset;

  return new Date(trueUTC).toISOString(); // Store/send as UTC
}


/**
 * Converts a Date or ISO string to a MySQL-compatible UTC format: "YYYY-MM-DD HH:MM:SS".
 * (We keep this as UTC by design — databases love UTC.)
 */
function toMySQLTimestamp(date = new Date()) {
  return new Date(date).toISOString().slice(0, 19).replace('T', ' ');
}


/* ----------------------------------------------------------------------------
   GET "TODAY" (AUSTIN) & MAP UTC→AUSTIN DAY
   ----------------------------------------------------------------------------
   Important rule:
   - NEVER compute a *local day* via toISOString().split('T')[0].
     That reinterprets as UTC and causes "tomorrow at ~7pm Austin".
   - Use Intl.DateTimeFormat(... timeZone:'America/Chicago') with formatToParts.
---------------------------------------------------------------------------- */

/**
 * Returns today's date in Austin local time as "YYYY-MM-DD".
 * This version *never* round-trips through UTC, so it won't flip at ~7pm.
 */
function getAustinDateString() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}


/**
 * Converts any ISO/UTC timestamp string to the corresponding Austin local date "YYYY-MM-DD".
 * Useful when grouping/filtering events by *Austin calendar day* regardless of user/browser tz.
 *
 * Example:
 *   getAustinDateStringFromISO('2025-05-05T04:00:00Z')  // → '2025-05-04' (if Austin is UTC-5 then)
 */
function getAustinDateStringFromISO(isoString) {
  const d = new Date(isoString); // interpret the instant (UTC or with zone)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);

  const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
}


/* ----------------------------------------------------------------------------
   EXPORTS (optional)
   ----------------------------------------------------------------------------
   - If your build uses ES modules and expects named exports, uncomment below.
   - If you load utils.js via a <script> tag and rely on globals, keep this off.
---------------------------------------------------------------------------- */
// export {
//   formatToAustinTime12h,
//   formatAllTimestamps,
//   toUTCFromAustin,
//   toMySQLTimestamp,
//   getAustinDateString,
//   getAustinDateStringFromISO
// };
