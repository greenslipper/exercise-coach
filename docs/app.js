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
let pendingGymDate = null;
let pendingWeightSync = null;

function scheduleGymSync(dateStr) {
  pendingGymDate = dateStr;
  if (gymSyncTimer) clearTimeout(gymSyncTimer);
  gymSyncTimer = setTimeout(flushGymSync, 30 * 1000);
}

function flushGymSync() {
  if (!pendingGymDate) return;
  const session = gymLog.find(s => s.date === pendingGymDate);
  if (session) workerPost('/gym-log', { date: session.date, session_type: 'strength', exercises: session.exercises });
  pendingGymDate = null;
  gymSyncTimer = null;
}

function scheduleWeightSync(date, weight_kg) {
  pendingWeightSync = { date, weight_kg };
  if (weightSyncTimer) clearTimeout(weightSyncTimer);
  weightSyncTimer = setTimeout(flushWeightSync, 3 * 60 * 1000);
}

function flushWeightSync() {
  if (!pendingWeightSync) return;
  workerPost('/weight', pendingWeightSync);
  pendingWeightSync = null;
  weightSyncTimer = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (gymSyncTimer) { clearTimeout(gymSyncTimer); flushGymSync(); }
    if (weightSyncTimer) { clearTimeout(weightSyncTimer); flushWeightSync(); }
  }
});

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
        const serverLogs = logs.map(s => {
          let name = s.session_type || 'Strength Session';
          for (const week of (planData ? planData.weeks || [] : [])) {
            const day = (week.days || []).find(d => d.date === s.date);
            if (day && day.name) { name = day.name; break; }
          }
          return { date: s.date, name, exercises: s.exercises || [] };
        });
        // Preserve any session currently pending a sync to the worker
        if (pendingGymDate && !serverLogs.find(s => s.date === pendingGymDate)) {
          const pending = gymLog.find(s => s.date === pendingGymDate);
          if (pending) serverLogs.push(pending);
        }
        serverLogs.sort((a, b) => a.date.localeCompare(b.date));
        gymLog = serverLogs;
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
            ${ex.youtube_url ? '<a class="ex-yt-link" href="' + ex.youtube_url + '" target="_blank" rel="noopener noreferrer">▶ Watch</a>' : ''}
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
            ${ex.youtube_url ? '<a class="ex-yt-link" href="' + ex.youtube_url + '" target="_blank" rel="noopener noreferrer">▶ Watch</a>' : ''}
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

// Prescribed weights — fallback when plan detail has no target weight
const PRESCRIBED_WEIGHTS = {
  'Leg Press': 100,
  'Calf Press (Gastrocnemius)': 30,
  'Single-Leg Seated Calf Raise': 70,
  'Cable Hip Abduction': 5,
  'Seated Hamstring Curl': 40,
  'Leg Extension (Single Leg)': 30,
  'Bulgarian Split Squat (Smith)': 30,
};

function openExerciseLog(dateStr, exName, target) {
  const isBodyweight = !target.includes('kg');
  const session = gymLog.find(s => s.date === dateStr);
  const existing = session ? session.exercises.find(e => e.name === exName) : null;

  // Bodyweight/plyo: one tap marks done, second tap opens modal to add note or unlog
  if (isBodyweight && !existing) {
    saveExerciseLog(dateStr, exName, '', 'Done');
    return;
  }

  const last = getLastLogged(exName);
  const prescribed = PRESCRIBED_WEIGHTS[exName];
  const planWeightMatch = target.match(/@\s*([\d.]+)\s*kg/i);
  const planWeight = planWeightMatch ? parseFloat(planWeightMatch[1]) : null;

  const defaultWeight = existing && existing.weight != null ? existing.weight
    : planWeight != null ? planWeight
    : prescribed != null ? prescribed
    : last ? last.weight
    : '';

  // Show/hide weight row for bodyweight exercises
  const weightField = document.getElementById('log-weight-field').closest('.log-field');
  weightField.style.display = isBodyweight ? 'none' : '';

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
  setTimeout(() => {
    if (isBodyweight) document.getElementById('log-notes-field').focus();
    else document.getElementById('log-weight-field').focus();
  }, 150);
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

  // Empty weight + empty note: remove the exercise entry (unlog)
  if (value == null && !note) {
    if (session) {
      const existing = session.exercises.find(e => e.name === exName);
      if (existing && existing.weight == null) {
        session.exercises = session.exercises.filter(e => e.name !== exName);
        saveGymLog();
        if (session.exercises.length > 0) scheduleGymSync(dateStr);
      }
    }
    closeLogModal();
    openModal(dateStr);
    renderGym();
    return;
  }

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
  const PL = 36, PR = 10, PT = 16, PB = 22, H = 120;
  const iH = H - PT - PB;

  const all = [...log].sort((a, b) => a.date.localeCompare(b.date));
  const n = all.length;
  if (n < 2) return '';

  const msOf = str => parseDate(str).getTime();
  const t0 = msOf(all[0].date);
  const t1 = msOf(all[n - 1].date);
  const totalDays = Math.max(1, (t1 - t0) / 86400000);
  // 7px per day — generous spacing so dots/labels don't crowd
  const iW = Math.max(300, Math.ceil(totalDays * 7));
  const W = PL + iW + PR;

  const toX = dateStr => PL + ((msOf(dateStr) - t0) / (t1 - t0)) * iW;
  const vals = all.map(e => e.weight);
  const rawMin = Math.min(...vals), rawMax = Math.max(...vals);
  const minV = Math.floor(rawMin * 2) / 2 - 0.5;
  const maxV = Math.ceil(rawMax * 2) / 2 + 0.5;
  const toY = v => PT + iH - ((v - minV) / (maxV - minV)) * iH;

  // Horizontal gridlines every 0.5 kg
  const gridHtml = [];
  for (let v = Math.ceil(minV * 2) / 2; v <= maxV + 0.001; v = Math.round((v + 0.5) * 10) / 10) {
    const y = toY(v).toFixed(1);
    const whole = Number.isInteger(v);
    gridHtml.push(
      `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="#ebebeb" stroke-width="${whole ? 1 : 0.5}"/>` +
      (whole ? `<text x="${PL - 4}" y="${(+y + 3.5).toFixed(1)}" fill="#bbb" font-size="8" text-anchor="end">${v}</text>` : '')
    );
  }

  // Month boundary lines + labels — scale naturally as data grows
  const d0 = parseDate(all[0].date);
  const d1 = parseDate(all[n - 1].date);
  const monthHtml = [];
  let mCur = new Date(d0.getFullYear(), d0.getMonth(), 1);
  while (mCur <= d1) {
    const x = +(PL + ((mCur.getTime() - t0) / (t1 - t0)) * iW).toFixed(1);
    if (x >= PL + 8 && x <= W - PR - 8) {
      const yr = mCur.getMonth() === 0 ? ' \'' + String(mCur.getFullYear()).slice(2) : '';
      monthHtml.push(
        `<line x1="${x}" y1="${PT}" x2="${x}" y2="${PT + iH}" stroke="#ebebeb" stroke-width="1" stroke-dasharray="3,3"/>` +
        `<text x="${x + 3}" y="${H - 5}" fill="#ccc" font-size="8">${MONTH_NAMES[mCur.getMonth()]}${yr}</text>`
      );
    }
    mCur = new Date(mCur.getFullYear(), mCur.getMonth() + 1, 1);
  }

  // Rolling 3-point trailing average
  const rolling = all.map((_, i) =>
    i < 2 ? null : (all[i].weight + all[i - 1].weight + all[i - 2].weight) / 3
  );

  const linePoints = all.map(e => `${toX(e.date).toFixed(1)},${toY(e.weight).toFixed(1)}`).join(' ');
  const areaPoints = `${PL},${PT + iH} ${linePoints} ${toX(all[n-1].date).toFixed(1)},${PT + iH}`;
  const avgPoints = rolling.map((v, i) => v !== null
    ? `${toX(all[i].date).toFixed(1)},${toY(v).toFixed(1)}`
    : null).filter(Boolean).join(' ');

  // Dots: label on first, last, and local peaks/troughs
  const dotsHtml = all.map((e, i) => {
    const x = +toX(e.date).toFixed(1);
    const y = +toY(e.weight).toFixed(1);
    const isFirst = i === 0, isLast = i === n - 1;
    const isHigh = i > 0 && i < n - 1 && e.weight > all[i-1].weight && e.weight > all[i+1].weight;
    const isLow  = i > 0 && i < n - 1 && e.weight < all[i-1].weight && e.weight < all[i+1].weight;
    const showLabel = isFirst || isLast || isHigh || isLow;
    const anchor = isFirst ? 'start' : 'end';
    const lx = (isFirst ? x + 2 : x - 2).toFixed(1);
    const labelY = isLow ? (y + 14).toFixed(1) : (y - 6).toFixed(1);
    return `<circle cx="${x}" cy="${y}" r="3.5" fill="#4fc3f7" stroke="#fff" stroke-width="1.5"/>` +
      (showLabel ? `<text x="${lx}" y="${labelY}" fill="#999" font-size="8.5" font-weight="600" text-anchor="${anchor}">${e.weight}</text>` : '');
  }).join('');

  return `<div class="weight-chart-scroll"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="weight-chart-svg">
    ${gridHtml.join('')}${monthHtml.join('')}
    <polygon points="${areaPoints}" fill="#4fc3f7" fill-opacity="0.1"/>
    <polyline points="${linePoints}" fill="none" stroke="#4fc3f7" stroke-width="2" stroke-linejoin="round" stroke-opacity="0.55"/>
    ${avgPoints ? `<polyline points="${avgPoints}" fill="none" stroke="#4fc3f7" stroke-width="2.5" stroke-linejoin="round"/>` : ''}
    ${dotsHtml}
  </svg></div>`;
}

// ── Weekly run chart ────────────────────────────────────────────────────────

const KEY_EXERCISES = [
  { name: 'leg press',                     short: 'Leg Press'     },
  { name: 'bulgarian split squat (smith)', short: 'Split Squat'   },
  { name: 'single-leg seated calf raise',  short: 'SL Calf Raise' },
  { name: 'calf press (gastrocnemius)',    short: 'Calf Press'    },
  { name: 'seated hamstring curl',         short: 'Ham Curl'      },
  { name: 'cable hip abduction',           short: 'Hip Abduction' },
];

function getWeekMonday(dateStr) {
  const d = parseDate(dateStr);
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((day + 6) % 7));
  return dateKey(mon);
}

function getWeeklyRunKm(numWeeks) {
  const todayMon = getWeekMonday(today());
  const weeks = [];
  for (let i = numWeeks - 1; i >= 0; i--) {
    const d = parseDate(todayMon);
    d.setDate(d.getDate() - i * 7);
    const wStart = dateKey(d);
    const wEnd = new Date(d); wEnd.setDate(d.getDate() + 6);
    const wEndStr = dateKey(wEnd);
    let km = 0;
    for (const [date, stats] of Object.entries(stravaRunStats)) {
      if (date >= wStart && date <= wEndStr) km += stats.distance_km || 0;
    }
    weeks.push({ weekStart: wStart, km: +km.toFixed(1) });
  }
  return weeks;
}

function buildWeeklyRunChart() {
  const weeks = getWeeklyRunKm(12);
  if (!weeks.some(w => w.km > 0)) return '';

  // Fixed logical dimensions — SVG scales to 100% container width
  const PL = 26, PR = 6, PT = 14, PB = 22, H = 120;
  const iH = H - PT - PB;
  const n = weeks.length;
  const barGap = 4;
  const barW = 26;
  const iW = n * (barW + barGap) - barGap;
  const W = PL + iW + PR;

  const maxKm = Math.max(...weeks.map(w => w.km), 1);
  const roundedMax = Math.ceil(maxKm / 10) * 10;
  const step = roundedMax <= 30 ? 10 : roundedMax <= 60 ? 20 : 30;

  const toY = km => PT + iH - (km / roundedMax) * iH;
  const todayMon = getWeekMonday(today());

  const gridHtml = [];
  for (let v = 0; v <= roundedMax; v += step) {
    const y = toY(v).toFixed(1);
    gridHtml.push(
      `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="#ebebeb" stroke-width="1"/>` +
      `<text x="${PL - 4}" y="${(+y + 3.5).toFixed(1)}" fill="#bbb" font-size="8" text-anchor="end">${v}</text>`
    );
  }

  const barsHtml = weeks.map(({ weekStart, km }, i) => {
    const x = PL + i * (barW + barGap);
    const bh = Math.max(0, ((km / roundedMax) * iH)).toFixed(1);
    const y = toY(km).toFixed(1);
    const isCurrent = weekStart === todayMon;
    const d = parseDate(weekStart);
    const label = `${d.getDate()}/${d.getMonth() + 1}`;
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="2"
            fill="var(--orange)" fill-opacity="${isCurrent ? '1' : '0.4'}"/>
      ${km > 0 ? `<text x="${(x + barW / 2).toFixed(1)}" y="${(+y - 3).toFixed(1)}"
            fill="${isCurrent ? 'var(--orange)' : '#bbb'}" font-size="8" text-anchor="middle" font-weight="${isCurrent ? '700' : '400'}">${km.toFixed(0)}</text>` : ''}
      <text x="${(x + barW / 2).toFixed(1)}" y="${H - 4}" fill="#ccc" font-size="7.5" text-anchor="middle">${label}</text>`;
  }).join('');

  return `<svg width="100%" viewBox="0 0 ${W} ${H}" class="run-chart-svg" preserveAspectRatio="xMidYMid meet" style="display:block">
    ${gridHtml.join('')}${barsHtml}
  </svg>`;
}

// ── Strength progression ─────────────────────────────────────────────────────

function getExerciseHistory(exerciseName) {
  const lower = exerciseName.toLowerCase();
  const history = [];
  for (const session of gymLog) {
    const ex = session.exercises.find(e => e.name.toLowerCase() === lower);
    if (ex && ex.weight != null) history.push({ date: session.date, weight: ex.weight });
  }
  return history.sort((a, b) => a.date.localeCompare(b.date));
}

function buildStrengthChart(history) {
  const PL = 36, PR = 10, PT = 16, PB = 22, H = 120;
  const iH = H - PT - PB;

  const all = [...history];
  const n = all.length;
  if (n < 2) return '';

  const msOf = str => parseDate(str).getTime();
  const t0 = msOf(all[0].date);
  const t1 = msOf(all[n - 1].date);
  const totalDays = Math.max(1, (t1 - t0) / 86400000);
  // 7px per day — generous spacing so dots/labels don't crowd
  const iW = Math.max(300, Math.ceil(totalDays * 7));
  const W = PL + iW + PR;

  const toX = dateStr => PL + ((msOf(dateStr) - t0) / (t1 - t0)) * iW;
  const vals = all.map(e => e.weight);
  const rawMin = Math.min(...vals), rawMax = Math.max(...vals);
  const range = rawMax - rawMin;
  const step = range <= 15 ? 2.5 : range <= 40 ? 5 : 10;
  const minV = Math.floor(rawMin / step) * step - step;
  const maxV = Math.ceil(rawMax / step) * step + step;
  const toY = v => PT + iH - ((v - minV) / (maxV - minV)) * iH;

  // Gridlines
  const gridHtml = [];
  for (let v = Math.ceil(minV / step) * step; v <= maxV + 0.001; v = Math.round((v + step) * 100) / 100) {
    const y = toY(v).toFixed(1);
    gridHtml.push(
      `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="#ebebeb" stroke-width="1"/>` +
      `<text x="${PL - 4}" y="${(+y + 3.5).toFixed(1)}" fill="#bbb" font-size="8" text-anchor="end">${v}</text>`
    );
  }

  // Month markers
  const d0 = parseDate(all[0].date), d1 = parseDate(all[n - 1].date);
  const monthHtml = [];
  let mCur = new Date(d0.getFullYear(), d0.getMonth(), 1);
  while (mCur <= d1) {
    const x = +(PL + ((mCur.getTime() - t0) / (t1 - t0)) * iW).toFixed(1);
    if (x >= PL + 8 && x <= W - PR - 8) {
      monthHtml.push(
        `<line x1="${x}" y1="${PT}" x2="${x}" y2="${PT + iH}" stroke="#ebebeb" stroke-width="1" stroke-dasharray="3,3"/>` +
        `<text x="${x + 3}" y="${H - 5}" fill="#ccc" font-size="8">${MONTH_NAMES[mCur.getMonth()]}</text>`
      );
    }
    mCur = new Date(mCur.getFullYear(), mCur.getMonth() + 1, 1);
  }

  const linePoints = all.map(e => `${toX(e.date).toFixed(1)},${toY(e.weight).toFixed(1)}`).join(' ');
  const areaPoints = `${PL},${PT + iH} ${linePoints} ${toX(all[n-1].date).toFixed(1)},${PT + iH}`;

  // Label every point — dataset is small enough
  const dotsHtml = all.map((e, i) => {
    const x = +toX(e.date).toFixed(1);
    const y = +toY(e.weight).toFixed(1);
    const isFirst = i === 0, isLast = i === n - 1;
    const isHigh = i > 0 && i < n - 1 && e.weight > all[i-1].weight && e.weight > all[i+1].weight;
    const isLow  = i > 0 && i < n - 1 && e.weight < all[i-1].weight && e.weight < all[i+1].weight;
    const showLabel = isFirst || isLast || isHigh || isLow;
    const anchor = isFirst ? 'start' : 'end';
    const lx = (isFirst ? x + 2 : x - 2).toFixed(1);
    const labelY = isLow ? (y + 14).toFixed(1) : (y - 6).toFixed(1);
    return `<circle cx="${x}" cy="${y}" r="3.5" fill="var(--purple)" stroke="#fff" stroke-width="1.5"/>` +
      (showLabel ? `<text x="${lx}" y="${labelY}" fill="#999" font-size="8.5" font-weight="600" text-anchor="${anchor}">${e.weight}</text>` : '');
  }).join('');

  return `<div class="strength-chart-scroll"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${gridHtml.join('')}${monthHtml.join('')}
    <polygon points="${areaPoints}" fill="var(--purple)" fill-opacity="0.1"/>
    <polyline points="${linePoints}" fill="none" stroke="var(--purple)" stroke-width="2" stroke-linejoin="round"/>
    ${dotsHtml}
  </svg></div>`;
}

function buildStrengthProgressionSection() {
  const cards = KEY_EXERCISES.map(({ name, short }) => {
    const history = getExerciseHistory(name);
    if (history.length === 0) return '';
    const latest = history[history.length - 1];
    const gain = +(latest.weight - history[0].weight).toFixed(1);
    const gainStr = gain > 0 ? `+${gain} kg` : gain < 0 ? `${gain} kg` : '';
    const chart = buildStrengthChart(history);
    return `
      <div class="strength-full-card">
        <div class="strength-full-header">
          <div class="strength-full-name">${short}</div>
          <div class="strength-full-right">
            <span class="strength-full-weight">${latest.weight} kg</span>
            ${gainStr ? `<span class="strength-full-gain">${gainStr}</span>` : ''}
          </div>
        </div>
        ${chart}
      </div>`;
  }).filter(Boolean).join('');
  if (!cards) return '';
  return `<div class="progress-section-title">Strength Progression</div>${cards}`;
}

function renderWeightCard() {
  const sorted = [...weightLog].sort((a, b) => a.date < b.date ? -1 : 1);
  const latest = sorted.length ? sorted[sorted.length - 1] : null;
  const first = sorted.length ? sorted[0] : null;

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

  const runChartCard = (() => {
    const chart = buildWeeklyRunChart();
    return chart ? `
      <div class="run-chart-card">
        <div class="run-chart-title">Weekly Distance</div>
        ${chart}
      </div>` : '';
  })();

  const configured = isWorkerConfigured();
  const syncBar = `
    <div class="worker-status">
      <span class="worker-badge${configured ? ' connected' : ''}">${configured ? '☁ Cloud sync active' : '☁ Cloud sync'}</span>
      <button class="worker-settings-btn" onclick="openSettings()">${configured ? '⚙' : 'Configure →'}</button>
    </div>`;

  section.innerHTML = renderWeightCard() + runChartCard + buildStrengthProgressionSection() + syncBar;

  requestAnimationFrame(() => {
    section.querySelectorAll('.weight-chart-scroll, .strength-chart-scroll').forEach(sc => {
      sc.scrollLeft = sc.scrollWidth;
    });
  });
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
