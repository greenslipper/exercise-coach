'use strict';

// ── Constants ──────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const WORKOUT_COLORS = {
  'rest':      'dot-rest',
  'easy':      'dot-run',
  'long':      'dot-long',
  'tempo':     'dot-tempo',
  'intervals': 'dot-intervals',
  'strides':   'dot-run',
  'race':      'dot-intervals',
  'strength':  'dot-strength',
};

// ── State ──────────────────────────────────────────────────────────────────

let planData = null;
let currentWeekIndex = 0;
let selectedDay = null;

// ── Gym log ────────────────────────────────────────────────────────────────

let gymLog = JSON.parse(localStorage.getItem('gymLog') || '[]');
let weightLog = JSON.parse(localStorage.getItem('weightLog') || '[]');
let runLog = JSON.parse(localStorage.getItem('runLog') || '[]');
let stravaRunDates = [];
let stravaRunStats = {};

function saveGymLog() {
  localStorage.setItem('gymLog', JSON.stringify(gymLog));
}

function saveWeightLog() {
  localStorage.setItem('weightLog', JSON.stringify(weightLog));
}

function saveRunLog() {
  localStorage.setItem('runLog', JSON.stringify(runLog));
}

// ── Worker sync ─────────────────────────────────────────────────────────────

let gymSyncTimer = null;
let weightSyncTimer = null;

function scheduleGymSync(dateStr) {
  if (gymSyncTimer) clearTimeout(gymSyncTimer);
  gymSyncTimer = setTimeout(() => {
    const session = gymLog.find(s => s.date === dateStr);
    if (session) workerPost('/gym-log', { date: session.date, session_type: 'strength', exercises: session.exercises });
    gymSyncTimer = null;
  }, 30 * 60 * 1000);
}

function scheduleWeightSync(date, weight_kg) {
  if (weightSyncTimer) clearTimeout(weightSyncTimer);
  weightSyncTimer = setTimeout(() => {
    workerPost('/weight', { date, weight_kg });
    weightSyncTimer = null;
  }, 3 * 60 * 1000);
}

function getWorkerConfig() {
  try { return JSON.parse(localStorage.getItem('workerConfig')) || {}; }
  catch { return {}; }
}

function isWorkerConfigured() {
  const { url, secret } = getWorkerConfig();
  return !!(url && secret);
}

async function workerPost(path, body) {
  const { url, secret } = getWorkerConfig();
  if (!url || !secret) return;
  try {
    await fetch(url + path, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + secret, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn('Worker sync failed:', e);
  }
}

async function loadFromWorker() {
  const { url, secret } = getWorkerConfig();
  if (!url || !secret) return;
  try {
    const headers = { 'Authorization': 'Bearer ' + secret };
    const [gymRes, weightRes] = await Promise.all([
      fetch(url + '/gym-log', { headers }),
      fetch(url + '/weight', { headers }),
    ]);
    if (gymRes.ok) {
      const logs = await gymRes.json();
      if (logs.length > 0) {
        gymLog = logs.map(s => {
          let name = s.session_type || 'Strength Session';
          for (const week of (planData ? planData.weeks || [] : [])) {
            const day = (week.days || []).find(d => d.date === s.date);
            if (day && day.name) { name = day.name; break; }
          }
          return { date: s.date, name, exercises: s.exercises || [] };
        });
        saveGymLog();
      }
    }
    if (weightRes.ok) {
      const entries = await weightRes.json();
      if (entries.length > 0) {
        weightLog = entries.map(e => ({ date: e.date, weight: e.weight_kg }));
        saveWeightLog();
      }
    }
  } catch (e) {
    console.warn('Worker load failed:', e);
  }
}

function openSettings() {
  const cfg = getWorkerConfig();
  document.getElementById('settings-url').value = cfg.url || '';
  document.getElementById('settings-secret').value = cfg.secret || '';
  const overlay = document.getElementById('settings-overlay');
  overlay.classList.add('open');
  overlay.onclick = (e) => { if (e.target === overlay) closeSettings(); };
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('open');
}

async function saveSettings() {
  const url = document.getElementById('settings-url').value.trim().replace(/\/$/, '');
  const secret = document.getElementById('settings-secret').value.trim();
  if (!url || !secret) return;
  localStorage.setItem('workerConfig', JSON.stringify({ url, secret }));
  closeSettings();
  await loadFromWorker();
  renderGym();
}

async function pushLocalDataToWorker() {
  const { url, secret } = getWorkerConfig();
  if (!url || !secret) return;

  const btn = document.getElementById('push-to-worker-btn');
  btn.disabled = true;
  btn.textContent = 'Uploading…';

  const headers = { 'Authorization': 'Bearer ' + secret, 'Content-Type': 'application/json' };
  let ok = 0, fail = 0;

  for (const session of gymLog) {
    if (!session.exercises || session.exercises.length === 0) continue;
    try {
      const res = await fetch(url + '/gym-log', {
        method: 'POST', headers,
        body: JSON.stringify({ date: session.date, session_type: 'strength', exercises: session.exercises }),
      });
      res.ok ? ok++ : fail++;
    } catch { fail++; }
  }

  for (const entry of weightLog) {
    try {
      const res = await fetch(url + '/weight', {
        method: 'POST', headers,
        body: JSON.stringify({ date: entry.date, weight_kg: entry.weight }),
      });
      res.ok ? ok++ : fail++;
    } catch { fail++; }
  }

  btn.disabled = false;
  btn.textContent = fail === 0
    ? `Done — ${ok} record${ok !== 1 ? 's' : ''} uploaded`
    : `${ok} uploaded, ${fail} failed`;
}

function isRunDoneViaStrava(dateStr) {
  return stravaRunDates.includes(dateStr);
}

function isRunDone(dateStr) {
  return isRunDoneViaStrava(dateStr) || runLog.includes(dateStr);
}

function isGymDone(dateStr) {
  return gymLog.some(s => s.date === dateStr && s.exercises && s.exercises.length > 0);
}

function toggleRunDone(dateStr) {
  const idx = runLog.indexOf(dateStr);
  if (idx >= 0) runLog.splice(idx, 1); else runLog.push(dateStr);
  saveRunLog();
  renderWeek();
  openModal(dateStr);
}

function getLastLogged(exerciseName) {
  for (let i = gymLog.length - 1; i >= 0; i--) {
    const ex = gymLog[i].exercises.find(e => e.name === exerciseName);
    if (ex && ex.weight != null) return ex;
  }
  return null;
}

// ── Data loading ───────────────────────────────────────────────────────────

async function loadPlan() {
  try {
    const res = await fetch('plan_data.json?v=' + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    planData = await res.json();
  } catch (e) {
    console.warn('Could not load plan_data.json:', e);
    planData = { generated: null, goal: null, weeks: [] };
  }
  try {
    const res = await fetch('strava_runs.json?v=' + Date.now());
    if (res.ok) {
      const data = await res.json();
      stravaRunDates = data.run_dates || [];
      stravaRunStats = data.runs || {};
    }
  } catch (e) {
    console.warn('Could not load strava_runs.json:', e);
  }
}

// ── Date helpers ───────────────────────────────────────────────────────────

function today() {
  const d = new Date();
  return dateKey(d);
}

function dateKey(d) {
  // Returns YYYY-MM-DD in local time
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDate(str) {
  // Parse YYYY-MM-DD without timezone shift
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDayLabel(dateStr) {
  const d = parseDate(dateStr);
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

function findCurrentWeek(weeks) {
  if (!weeks || weeks.length === 0) return 0;
  const t = today();
  for (let i = 0; i < weeks.length; i++) {
    const week = weeks[i];
    if (!week.days || week.days.length === 0) continue;
    const dates = week.days.map(d => d.date).filter(Boolean);
    if (dates.length === 0) continue;
    const start = dates[0];
    const end = dates[dates.length - 1];
    if (t >= start && t <= end) return i;
  }
  // Not in any week — find closest upcoming
  for (let i = 0; i < weeks.length; i++) {
    const week = weeks[i];
    if (!week.days) continue;
    const dates = week.days.map(d => d.date).filter(Boolean);
    if (dates.length && dates[0] > t) return i;
  }
  return weeks.length - 1;
}

// ── Render ─────────────────────────────────────────────────────────────────

function render() {
  renderHeader();
  if (!planData.weeks || planData.weeks.length === 0) {
    renderEmpty();
    return;
  }
  document.getElementById('tab-nav').style.display = '';
  renderToday();
  renderWeek();
  renderPlan();
  renderGym();
}

function renderHeader() {
  const goalEl = document.getElementById('goal-badge');
  goalEl.textContent = planData.goal || '5K Training';
  document.getElementById('generated-date').textContent =
    planData.generated ? `Updated ${planData.generated}` : 'No plan yet';
}

function renderEmpty() {
  document.getElementById('today-section').innerHTML = '';
  document.getElementById('tab-nav').style.display = 'none';
  document.getElementById('main-content').innerHTML = `
    <div class="empty-state">
      <h2>No training plan yet</h2>
      <p>
        Complete Strava setup, sync your data, then open a Claude Code session.<br><br>
        Claude will read your profile and create a personalised 5K plan that shows up here.
      </p>
      <p style="margin-top:1rem">
        <code>python scripts/setup_strava.py</code><br>
        <code>python scripts/sync_strava.py</code>
      </p>
    </div>
  `;
}

function renderToday() {
  const t = today();
  let todayWorkout = null;

  for (const week of planData.weeks) {
    if (!week.days) continue;
    const found = week.days.find(d => d.date === t);
    if (found) { todayWorkout = found; break; }
  }

  const section = document.getElementById('today-section');
  const isRest = !todayWorkout || todayWorkout.type === 'rest' || !todayWorkout.type;

  section.innerHTML = `
    <div class="today-card ${isRest ? 'rest-day' : ''} ${todayWorkout ? 'today-card-tappable' : ''}"
         ${todayWorkout ? `onclick="openModal('${t}')"` : ''}>
      <div class="today-label">Today</div>
      <div class="today-workout-name">${
        todayWorkout ? (todayWorkout.name || titleCase(todayWorkout.type) || 'Rest Day') : 'Rest Day'
      }</div>
      <div class="today-workout-desc">${
        todayWorkout ? (todayWorkout.description || '') : 'No workout scheduled — recover and recharge.'
      }</div>
      ${todayWorkout ? '<div class="today-arrow">›</div>' : ''}
    </div>
  `;
}

function renderWeek() {
  const weeks = planData.weeks;
  const week = weeks[currentWeekIndex];
  const section = document.getElementById('week-section');

  const prevDisabled = currentWeekIndex === 0 ? 'disabled' : '';
  const nextDisabled = currentWeekIndex === weeks.length - 1 ? 'disabled' : '';
  const weekLabel = (week.label || `Week ${currentWeekIndex + 1}`)
    .replace(/^Week \d+/, `Week ${currentWeekIndex + 1}/${weeks.length}`);
  const phase = week.phase ? `<div class="phase-label">${week.phase}</div>` : '';

  // Calculate week stats
  const totalKm = (week.days || []).reduce((sum, d) => sum + (d.distance_km || 0), 0);
  const workoutCount = (week.days || []).filter(d => d.type && d.type !== 'rest').length;

  const t = today();
  const dayCells = (week.days || []).map(day => {
    const isToday = day.date === t;
    const isPast = day.date < t;
    const dotClass = WORKOUT_COLORS[day.type] || 'dot-rest';
    const typeLabel = day.type && day.type !== 'rest'
      ? `<div class="day-type-label">${day.type}</div>` : '';
    const isStrengthDay = day.type === 'strength';
    const isRunDay = day.type && day.type !== 'rest' && day.type !== 'strength';
    const isDone = isStrengthDay ? isGymDone(day.date) : (isRunDay ? isRunDone(day.date) : false);
    const doneTick = isDone ? '<span class="done-tick">✓</span>' : '';

    return `
      <div class="day-cell ${isToday ? 'today' : ''} ${day.type === 'rest' ? 'rest' : ''} ${isPast && !isToday ? 'completed' : ''}"
           data-date="${day.date}"
           onclick="openModal('${day.date}')">
        <div class="day-name">${day.date ? DAY_NAMES[parseDate(day.date).getDay()] : ''}</div>
        <div class="day-date">${day.date ? parseDate(day.date).getDate() : ''}</div>
        ${typeLabel}
        <div class="day-dot ${dotClass}"></div>
        ${doneTick}
      </div>
    `;
  }).join('');

  const statsHtml = totalKm > 0 ? `
    <div class="week-summary">
      <div class="summary-pill"><strong>${totalKm.toFixed(1)} km</strong> this week</div>
      <div class="summary-pill"><strong>${workoutCount}</strong> workouts</div>
    </div>
  ` : '';

  section.innerHTML = `
    ${phase}
    <div class="week-nav">
      <div class="week-nav-title">${weekLabel}</div>
      <div class="week-nav-buttons">
        <button class="nav-btn" ${prevDisabled} onclick="changeWeek(-1)" aria-label="Previous week">‹</button>
        <button class="nav-btn" ${nextDisabled} onclick="changeWeek(1)" aria-label="Next week">›</button>
      </div>
    </div>
    <div class="week-grid">${dayCells}</div>
    ${statsHtml}
  `;
}

// ── Modal ──────────────────────────────────────────────────────────────────

function openModal(dateStr) {
  let workout = null;
  for (const week of planData.weeks) {
    if (!week.days) continue;
    const found = week.days.find(d => d.date === dateStr);
    if (found) { workout = found; break; }
  }
  if (!workout) return;

  const overlay = document.getElementById('modal-overlay');
  document.getElementById('modal-date').textContent = formatDayLabel(dateStr);
  document.getElementById('modal-title').textContent =
    workout.name || titleCase(workout.type) || 'Rest Day';

  const descEl = document.getElementById('modal-desc');
  const descText = workout.description || (workout.type === 'rest' ? 'Rest and recover.' : '');

  const isRunDay = workout.type && workout.type !== 'rest' && workout.type !== 'strength';

  if (workout.exercises && workout.exercises.length > 0) {
    const isStrength = workout.type === 'strength';
    const sessionForDate = isStrength ? gymLog.find(s => s.date === dateStr) : null;

    const items = workout.exercises.map(ex => {
      const metric = ex.detail !== undefined ? ex.detail : (ex.sets + ' × ' + ex.reps);

      if (isStrength) {
        const sessionEx = sessionForDate ? sessionForDate.exercises.find(e => e.name === ex.name) : null;
        const last = getLastLogged(ex.name);
        const safeExName = ex.name.replace(/'/g, "\\'");
        const safeMetric = metric.replace(/'/g, "\\'");
        const isLogged = sessionEx != null && (sessionEx.weight != null || sessionEx.note);
        const logBtnLabel = isLogged
          ? (sessionEx.weight != null ? '✓ ' + sessionEx.weight + ' kg' : '✓')
          : '+';
        const lastHint = !isLogged && last
          ? `<span class="ex-last-hint">${last.weight > 0 ? 'Last: ' + last.weight + ' kg' : 'Last: BW'}</span>`
          : '';
        return `
          <li class="exercise-item">
            <div class="exercise-header">
              <span class="exercise-name">${ex.name}</span>
              <div class="ex-header-right">
                <span class="exercise-sets">${metric}</span>
                <button class="ex-log-btn${isLogged ? ' logged' : ''}"
                        onclick="openExerciseLog('${dateStr}', '${safeExName}', '${safeMetric}')">${logBtnLabel}</button>
              </div>
            </div>
            ${lastHint}
            ${sessionEx && sessionEx.note ? `<div class="ex-logged-note">${sessionEx.note}</div>` : ''}
            ${ex.how_to ? '<p class="exercise-cue">' + ex.how_to + '</p>' : ''}
          </li>
        `;
      } else {
        return `
          <li class="exercise-item">
            <div class="exercise-header">
              <span class="exercise-name">${ex.name}</span>
              <span class="exercise-sets">${metric}</span>
            </div>
            ${ex.how_to ? '<p class="exercise-cue">' + ex.how_to + '</p>' : ''}
          </li>
        `;
      }
    }).join('');

    descEl.innerHTML = `<p class="modal-desc-text">${descText}</p><ul class="exercise-list">${items}</ul>`;
  } else {
    descEl.innerHTML = `<p class="modal-desc-text">${descText}</p>`;
  }

  if (isRunDay) {
    if (isRunDoneViaStrava(dateStr)) {
      const stats = stravaRunStats[dateStr];
      const statsHtml = stats
        ? `<span class="run-stats">${stats.distance_km} km &middot; ${stats.moving_time_min} min${stats.avg_pace ? ' &middot; ' + stats.avg_pace + '/km' : ''}</span>`
        : '';
      descEl.innerHTML += `<div class="run-done-wrap">
        <span class="run-done-strava">✓ Strava ${statsHtml}</span>
      </div>`;
    } else {
      const isDone = runLog.includes(dateStr);
      descEl.innerHTML += `<div class="run-done-wrap">
        <button class="run-done-btn${isDone ? ' done' : ''}" onclick="toggleRunDone('${dateStr}')">
          ${isDone ? '✓ Completed' : 'Mark as done'}
        </button>
      </div>`;
    }
  }

  overlay.classList.add('open');
  selectedDay = dateStr;
  overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  selectedDay = null;
}

// ── Navigation ─────────────────────────────────────────────────────────────

function changeWeek(delta) {
  const newIndex = currentWeekIndex + delta;
  if (newIndex < 0 || newIndex >= planData.weeks.length) return;
  currentWeekIndex = newIndex;
  renderWeek();
}

// ── Utilities ──────────────────────────────────────────────────────────────

function titleCase(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── Tab switching ──────────────────────────────────────────────────────────

function showTab(name) {
  document.getElementById('week-section').style.display = name === 'week' ? '' : 'none';
  document.getElementById('plan-section').style.display = name === 'plan' ? '' : 'none';
  document.getElementById('gym-section').style.display = name === 'gym' ? '' : 'none';
  document.getElementById('tab-week').classList.toggle('active', name === 'week');
  document.getElementById('tab-plan').classList.toggle('active', name === 'plan');
  document.getElementById('tab-gym').classList.toggle('active', name === 'gym');
}

// ── Plan overview ───────────────────────────────────────────────────────────

function phaseGroup(phaseName) {
  if (!phaseName) return 'Training';
  const p = phaseName.toLowerCase();
  if (p.includes('base') || p.includes('build')) return 'Foundation';
  if (p.includes('peak')) return 'Peak';
  if (p.includes('taper') || p.includes('race')) return 'Race Prep';
  return phaseName;
}

function renderPlan() {
  const section = document.getElementById('plan-section');
  const weeks = planData.weeks;
  const t = today();

  // Group consecutive weeks by broad phase category
  const groups = [];
  let currentGroup = null;
  weeks.forEach((week, i) => {
    const groupName = phaseGroup(week.phase);
    if (!currentGroup || currentGroup.name !== groupName) {
      currentGroup = { name: groupName, weeks: [] };
      groups.push(currentGroup);
    }
    currentGroup.weeks.push({ week, index: i });
  });

  const groupsHtml = groups.map(group => {
    const rowsHtml = group.weeks.map(({ week, index: i }) => {
      const totalKm = (week.days || []).reduce((sum, d) => sum + (d.distance_km || 0), 0);
      const isCurrentWeek = i === currentWeekIndex;

      // Date range from first/last day
      const days = (week.days || []).filter(d => d.date);
      let dateRange = '';
      if (days.length) {
        const s = parseDate(days[0].date);
        const e = parseDate(days[days.length - 1].date);
        dateRange = `${s.getDate()} ${MONTH_NAMES[s.getMonth()]} – ${e.getDate()} ${MONTH_NAMES[e.getMonth()]}`;
      }

      const dots = (week.days || []).map(day => {
        const dotClass = WORKOUT_COLORS[day.type] || 'dot-rest';
        const isToday = day.date === t;
        return `<div class="plan-dot ${dotClass}${isToday ? ' plan-dot-today' : ''}"
                     onclick="openModal('${day.date}')"></div>`;
      }).join('');

      const kmText = totalKm > 0
        ? `<span class="plan-week-km">${totalKm.toFixed(0)} km</span>`
        : '';

      return `
        <div class="plan-week-row${isCurrentWeek ? ' current-week' : ''}">
          <div class="plan-week-info">
            <div class="plan-week-label">${week.label || `Week ${i + 1}`}</div>
            ${dateRange ? `<div class="plan-week-dates">${dateRange}</div>` : ''}
          </div>
          <div class="plan-week-dots">${dots}</div>
          ${kmText}
        </div>
      `;
    }).join('');

    return `
      <div class="plan-phase-group">
        <div class="plan-phase-group-header">
          <span class="plan-phase-group-label">${group.name}</span>
        </div>
        ${rowsHtml}
      </div>
    `;
  }).join('');

  const legend = `
    <div class="plan-legend">
      <span class="legend-item"><span class="legend-dot dot-run"></span>Easy</span>
      <span class="legend-item"><span class="legend-dot dot-long"></span>Long</span>
      <span class="legend-item"><span class="legend-dot dot-tempo"></span>Tempo</span>
      <span class="legend-item"><span class="legend-dot dot-intervals"></span>Intervals</span>
      <span class="legend-item"><span class="legend-dot dot-strength"></span>Strength</span>
      <span class="legend-item"><span class="legend-dot dot-rest"></span>Rest</span>
    </div>
  `;

  section.innerHTML = `<div class="plan-list">${legend}${groupsHtml}</div>`;
}

// ── Gym logging ─────────────────────────────────────────────────────────────

// Prescribed weights from Yasmin's plan — used as default when no prior log exists
const PRESCRIBED_WEIGHTS = {
  'Leg Press': 90,
  'Calf Press (Gastrocnemius)': 25,
  'Single-Leg Seated Calf Raise': 65,
  'Cable Hip Abduction': 5,
  'Seated Hamstring Curl': 30,
  'Leg Extension (Single Leg)': 30,
  'Bulgarian Split Squat (Smith)': 30,
  'Pogo Jumps': null,
  'Pogo Hops (Single-Leg)': null,
};

function openExerciseLog(dateStr, exName, target) {
  const session = gymLog.find(s => s.date === dateStr);
  const existing = session ? session.exercises.find(e => e.name === exName) : null;
  const last = getLastLogged(exName);
  const prescribed = PRESCRIBED_WEIGHTS[exName];

  const defaultWeight = existing && existing.weight != null ? existing.weight
    : last ? last.weight
    : (prescribed != null ? prescribed : '');

  document.getElementById('log-modal-date').textContent = target;
  document.getElementById('log-modal-title').textContent = exName;
  document.getElementById('log-weight-field').value = defaultWeight;
  document.getElementById('log-notes-field').value = existing ? (existing.note || '') : '';

  // Reset quick-note pill selection
  document.querySelectorAll('.quick-note-btn').forEach(b => b.classList.remove('selected'));
  if (existing && existing.note) {
    document.querySelectorAll('.quick-note-btn').forEach(b => {
      if (b.dataset.note === existing.note) b.classList.add('selected');
    });
  }

  document.getElementById('log-save-btn').onclick = () => {
    const weight = document.getElementById('log-weight-field').value;
    const note = document.getElementById('log-notes-field').value.trim();
    saveExerciseLog(dateStr, exName, weight, note);
  };

  const logOverlay = document.getElementById('log-overlay');
  logOverlay.classList.add('open');
  logOverlay.onclick = (e) => { if (e.target === logOverlay) closeLogModal(); };
  setTimeout(() => document.getElementById('log-weight-field').focus(), 150);
}

function setQuickNote(btn, text) {
  const notesField = document.getElementById('log-notes-field');
  const isSelected = btn.classList.contains('selected');
  document.querySelectorAll('.quick-note-btn').forEach(b => b.classList.remove('selected'));
  if (isSelected) {
    notesField.value = '';
  } else {
    btn.classList.add('selected');
    notesField.value = text;
  }
}

function saveExerciseLog(dateStr, exName, rawWeight, note) {
  const value = rawWeight !== '' ? parseFloat(rawWeight) : null;
  let session = gymLog.find(s => s.date === dateStr);
  if (!session) {
    let workoutName = 'Strength Session';
    for (const week of planData.weeks) {
      if (!week.days) continue;
      const found = week.days.find(d => d.date === dateStr);
      if (found) { workoutName = found.name; break; }
    }
    session = { date: dateStr, name: workoutName, exercises: [] };
    gymLog.push(session);
    gymLog.sort((a, b) => a.date.localeCompare(b.date));
  }
  const existing = session.exercises.find(e => e.name === exName);
  if (existing) {
    existing.weight = value;
    existing.note = note || null;
  } else {
    session.exercises.push({ name: exName, weight: value, note: note || null });
  }
  saveGymLog();
  const updatedSession = gymLog.find(s => s.date === dateStr);
  if (updatedSession) scheduleGymSync(dateStr);
  closeLogModal();
  openModal(dateStr);
  renderGym();
}

function closeLogModal() {
  document.getElementById('log-overlay').classList.remove('open');
}

function buildWeightChart(log) {
  const W = 320, H = 120, PL = 32, PR = 12, PT = 10, PB = 24;
  const iW = W - PL - PR, iH = H - PT - PB;

  const all = [...log].sort((a, b) => a.date.localeCompare(b.date));
  const sorted = all.slice(-6);
  const n = sorted.length;
  if (n < 2) return '';

  // 3-reading rolling average (undefined for first 2 points)
  const rolling = sorted.map((_, i) =>
    i < 2 ? null : (sorted[i].weight + sorted[i-1].weight + sorted[i-2].weight) / 3
  );

  const vals = sorted.map(e => e.weight);
  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);
  // Round grid to nearest 0.5 kg
  const minV = Math.floor(rawMin * 2) / 2 - 0.5;
  const maxV = Math.ceil(rawMax * 2) / 2 + 0.5;

  const toX = i => PL + (i / (n - 1)) * iW;
  const toY = v => PT + iH - ((v - minV) / (maxV - minV)) * iH;

  // Horizontal gridlines every 0.5 kg
  const gridStep = 0.5;
  const gridVals = [];
  for (let v = Math.ceil(minV / gridStep) * gridStep; v <= maxV; v = Math.round((v + gridStep) * 10) / 10) {
    gridVals.push(v);
  }
  const gridHtml = gridVals.map(v => {
    const y = toY(v);
    const isWhole = Number.isInteger(v);
    return `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}"
        stroke="#333355" stroke-width="${isWhole ? 1 : 0.5}"/>
      <text x="${PL - 3}" y="${y + 3.5}" fill="${isWhole ? '#888' : '#555'}" font-size="8" text-anchor="end">${v % 1 === 0 ? v : ''}</text>`;
  }).join('');

  const points = sorted.map((e, i) => `${toX(i)},${toY(e.weight)}`).join(' ');
  const areaPoints = `${PL},${PT + iH} ${points} ${toX(n - 1)},${PT + iH}`;

  const avgPoints = rolling
    .map((v, i) => v !== null ? `${toX(i)},${toY(v)}` : null)
    .filter(Boolean).join(' ');

  const dots = sorted.map((e, i) => {
    const x = toX(i), y = toY(e.weight);
    const label = i === 0 || i === n - 1 ? e.weight + ' kg' : '';
    const anchor = i === 0 ? 'start' : 'end';
    return `<circle cx="${x}" cy="${y}" r="3" fill="#4fc3f7" stroke="white" stroke-width="1"/>
      ${label ? `<text x="${x}" y="${y - 7}" fill="#ccc" font-size="9" text-anchor="${anchor}">${label}</text>` : ''}`;
  }).join('');

  const tickHtml = [0, n - 1].map(i => {
    const anchor = i === 0 ? 'start' : 'end';
    return `<text x="${toX(i)}" y="${H - 4}" fill="#888" font-size="9" text-anchor="${anchor}">${sorted[i].date.slice(5).replace('-', '/')}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="weight-chart-svg">
    ${gridHtml}
    <polygon points="${areaPoints}" fill="#4fc3f7" fill-opacity="0.08"/>
    <polyline points="${points}" fill="none" stroke="#4fc3f7" stroke-width="1.5" stroke-opacity="0.5"/>
    ${avgPoints ? `<polyline points="${avgPoints}" fill="none" stroke="#4fc3f7" stroke-width="2.5"/>` : ''}
    ${dots}
    ${tickHtml}
  </svg>`;
}

function renderWeightCard() {
  const latest = weightLog.length ? weightLog[weightLog.length - 1] : null;
  const first = weightLog.length ? weightLog[0] : null;

  let trendHtml = '';
  if (latest && first && weightLog.length > 1) {
    const diff = (latest.weight - first.weight).toFixed(1);
    const sign = diff >= 0 ? '+' : '';
    const arrow = diff >= 0 ? '↑' : '↓';
    trendHtml = `<div class="weight-trend">${arrow} ${sign}${diff} kg since ${formatDayLabel(first.date)}</div>`;
  } else if (latest) {
    trendHtml = `<div class="weight-trend">Baseline set</div>`;
  }

  const chartSvg = weightLog.length >= 2 ? buildWeightChart(weightLog) : '';

  return `
    <div class="weight-card">
      <div class="weight-card-header">
        <div class="weight-card-title">Body Weight</div>
        <button class="weight-log-btn" onclick="toggleWeightForm()">+ Log</button>
      </div>
      <div id="weight-form" class="weight-form" style="display:none">
        <input type="number" id="weight-input" class="weight-input"
               placeholder="kg" step="0.1" min="30" max="200" inputmode="decimal">
        <button class="weight-save-btn" onclick="saveBodyWeight()">Save</button>
      </div>
      ${latest
        ? `<div class="weight-current">${latest.weight} <span class="weight-unit">kg</span></div>${trendHtml}`
        : `<div class="weight-empty">No data yet — tap + Log to start</div>`
      }
      ${chartSvg}
    </div>
  `;
}

function toggleWeightForm() {
  const form = document.getElementById('weight-form');
  if (!form) return;
  const showing = form.style.display !== 'none';
  form.style.display = showing ? 'none' : 'flex';
  if (!showing) document.getElementById('weight-input').focus();
}

function saveBodyWeight() {
  const input = document.getElementById('weight-input');
  const val = parseFloat(input.value);
  if (!val || val < 30 || val > 200) return;
  const t = today();
  weightLog = weightLog.filter(e => e.date !== t);
  weightLog.push({ date: t, weight: val });
  weightLog.sort((a, b) => a.date.localeCompare(b.date));
  saveWeightLog();
  scheduleWeightSync(t, val);
  renderGym();
}

function renderGym() {
  const section = document.getElementById('gym-section');
  if (!section) return;

  const weightCard = renderWeightCard();

  const sessionsHtml = [...gymLog].reverse().map(session => {
    const exRows = session.exercises
      .filter(ex => ex.weight != null || ex.note)
      .map(ex => `
        <div class="gym-log-ex">
          <span class="gym-log-ex-name">${ex.name}</span>
          <span class="gym-log-ex-weight">${ex.weight != null ? (ex.weight > 0 ? ex.weight + ' kg' : 'BW') : '—'}</span>
        </div>
        ${ex.note ? `<div class="gym-log-ex-note">${ex.note}</div>` : ''}
      `).join('');
    const skipped = session.exercises.filter(ex => ex.weight == null && !ex.note).length;
    const skipNote = skipped > 0 ? `<div class="gym-log-skip">${skipped} exercise${skipped > 1 ? 's' : ''} not logged</div>` : '';
    return `
      <div class="gym-log-card">
        <div class="gym-log-header">
          <div class="gym-log-name">${session.name}</div>
          <div class="gym-log-date">${formatDayLabel(session.date)}</div>
        </div>
        <div class="gym-log-exercises">${exRows}${skipNote}</div>
      </div>
    `;
  }).join('');

  const configured = isWorkerConfigured();
  const syncBar = `
    <div class="worker-status">
      <span class="worker-badge${configured ? ' connected' : ''}">
        ${configured ? '☁ Cloud sync active' : '☁ Cloud sync'}
      </span>
      <button class="worker-settings-btn" onclick="openSettings()">
        ${configured ? '⚙' : 'Configure →'}
      </button>
    </div>
  `;

  const sessionsSection = gymLog.length > 0 ? `
    <div class="gym-log-list">${sessionsHtml}</div>
  ` : `
    <div class="gym-empty">
      <p>No sessions logged yet.</p>
      <p>Tap a strength day, then log each exercise.</p>
    </div>
  `;

  section.innerHTML = weightCard + syncBar + sessionsSection;
}

function exportForClaude() {
  if (gymLog.length === 0 && weightLog.length === 0) return;

  const weightSection = weightLog.length > 0
    ? 'Body Weight\n' + '─'.repeat(40) + '\n' +
      weightLog.map(e => `${e.date}  ${e.weight} kg`).join('\n') + '\n\n'
    : '';

  const lines = gymLog.map(session => {
    const exLines = session.exercises.map(ex => {
      const w = ex.weight != null ? (ex.weight > 0 ? ex.weight + ' kg' : 'BW') : 'not logged';
      const noteStr = ex.note ? ` [${ex.note}]` : '';
      return `  - ${ex.name}: ${w}${noteStr}`;
    }).join('\n');
    return `${session.date}  ${session.name}\n${exLines}`;
  });

  const gymSection = lines.length > 0
    ? 'Gym Log\n' + '─'.repeat(40) + '\n\n' + lines.join('\n\n')
    : '';

  const text = weightSection + gymSection;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.querySelector('.export-btn');
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      btn.style.background = 'var(--green)';
      setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 2000);
    });
  } else {
    prompt('Copy this and paste into Claude:', text);
  }
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  await loadPlan();
  currentWeekIndex = findCurrentWeek(planData.weeks);
  render(); // render immediately with cached localStorage data
  await loadFromWorker(); // silently refresh from cloud
  render(); // re-render with latest cloud data
}

document.addEventListener('DOMContentLoaded', init);
