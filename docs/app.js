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

function saveGymLog() {
  localStorage.setItem('gymLog', JSON.stringify(gymLog));
}

function saveWeightLog() {
  localStorage.setItem('weightLog', JSON.stringify(weightLog));
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

    return `
      <div class="day-cell ${isToday ? 'today' : ''} ${day.type === 'rest' ? 'rest' : ''} ${isPast && !isToday ? 'completed' : ''}"
           data-date="${day.date}"
           onclick="openModal('${day.date}')">
        <div class="day-name">${day.date ? DAY_NAMES[parseDate(day.date).getDay()] : ''}</div>
        <div class="day-date">${day.date ? parseDate(day.date).getDate() : ''}</div>
        ${typeLabel}
        <div class="day-dot ${dotClass}"></div>
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

  if (workout.exercises && workout.exercises.length > 0) {
    const isStrength = workout.type === 'strength';
    const sessionForDate = isStrength ? gymLog.find(s => s.date === dateStr) : null;

    const items = workout.exercises.map(ex => {
      const metric = ex.detail !== undefined ? ex.detail : (ex.sets + ' × ' + ex.reps);

      if (isStrength) {
        const last = getLastLogged(ex.name);
        const sessionEx = sessionForDate ? sessionForDate.exercises.find(e => e.name === ex.name) : null;
        const currentVal = sessionEx != null ? sessionEx.weight : (last ? last.weight : '');
        const lastLabel = last ? (last.weight > 0 ? 'Last: ' + last.weight + ' kg' : 'Last: BW') : '';
        const safeExName = ex.name.replace(/'/g, "\\'");
        return `
          <li class="exercise-item">
            <div class="exercise-header">
              <span class="exercise-name">${ex.name}</span>
              <span class="exercise-sets">${metric}</span>
            </div>
            <div class="exercise-log-row">
              <input type="number" class="ex-weight-input"
                     value="${currentVal}"
                     placeholder="kg" step="2.5" min="0" inputmode="decimal"
                     onchange="saveExerciseWeight('${dateStr}', '${safeExName}', this.value)">
              <span class="ex-weight-unit">kg</span>
              ${lastLabel ? `<span class="ex-last-tag">${lastLabel}</span>` : ''}
            </div>
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
    descEl.textContent = descText;
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

function saveExerciseWeight(dateStr, exName, rawValue) {
  const value = rawValue !== '' ? parseFloat(rawValue) : null;
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
  } else {
    session.exercises.push({ name: exName, target: '', weight: value });
  }
  saveGymLog();
  renderGym();
}

// ── Gym logging ─────────────────────────────────────────────────────────────

function openLogSession(dateStr) {
  closeModal();

  let workout = null;
  for (const week of planData.weeks) {
    if (!week.days) continue;
    const found = week.days.find(d => d.date === dateStr);
    if (found) { workout = found; break; }
  }
  if (!workout || !workout.exercises) return;

  const existing = gymLog.find(s => s.date === dateStr);

  const exercises = workout.exercises.map(ex => {
    const last = getLastLogged(ex.name);
    const existingEx = existing ? existing.exercises.find(e => e.name === ex.name) : null;
    const weight = existingEx != null ? existingEx.weight : (last ? last.weight : null);
    const metric = ex.detail !== undefined ? ex.detail : (ex.sets + ' × ' + ex.reps);
    return { name: ex.name, target: metric, weight };
  });

  document.getElementById('log-modal-date').textContent = formatDayLabel(dateStr);
  document.getElementById('log-modal-title').textContent = workout.name;

  document.getElementById('log-exercises').innerHTML = exercises.map((ex, i) => `
    <div class="log-exercise-row">
      <div class="log-ex-info">
        <div class="log-ex-name">${ex.name}</div>
        <div class="log-ex-target">${ex.target}</div>
      </div>
      <div class="log-ex-weight">
        <input type="number" class="log-weight-input" id="log-w-${i}"
               value="${ex.weight != null ? ex.weight : ''}"
               placeholder="—" step="2.5" min="0" inputmode="decimal">
        <span class="log-weight-unit">kg</span>
      </div>
    </div>
  `).join('');

  document.getElementById('log-save-btn').onclick = () => {
    const saved = exercises.map((ex, i) => {
      const val = document.getElementById('log-w-' + i).value;
      return { name: ex.name, target: ex.target, weight: val !== '' ? parseFloat(val) : null };
    });
    gymLog = gymLog.filter(s => s.date !== dateStr);
    gymLog.push({ date: dateStr, name: workout.name, exercises: saved });
    gymLog.sort((a, b) => a.date.localeCompare(b.date));
    saveGymLog();
    closeLogModal();
    renderGym();
    showTab('gym');
  };

  const logOverlay = document.getElementById('log-overlay');
  logOverlay.classList.add('open');
  logOverlay.onclick = (e) => { if (e.target === logOverlay) closeLogModal(); };
}

function closeLogModal() {
  document.getElementById('log-overlay').classList.remove('open');
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

  const recentHtml = [...weightLog].reverse().slice(0, 5).map(e =>
    `<div class="weight-entry">
      <span class="weight-entry-date">${formatDayLabel(e.date)}</span>
      <span class="weight-entry-val">${e.weight} kg</span>
    </div>`
  ).join('');

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
      ${recentHtml ? `<div class="weight-history">${recentHtml}</div>` : ''}
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
  renderGym();
}

function renderGym() {
  const section = document.getElementById('gym-section');
  if (!section) return;

  const weightCard = renderWeightCard();

  const sessionsHtml = [...gymLog].reverse().map(session => {
    const exRows = session.exercises
      .filter(ex => ex.weight != null)
      .map(ex => `
        <div class="gym-log-ex">
          <span class="gym-log-ex-name">${ex.name}</span>
          <span class="gym-log-ex-weight">${ex.weight > 0 ? ex.weight + ' kg' : 'BW'}</span>
        </div>
      `).join('');
    const skipped = session.exercises.filter(ex => ex.weight == null).length;
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

  const sessionsSection = gymLog.length > 0 ? `
    <div class="gym-toolbar">
      <button class="export-btn" onclick="exportForClaude()">Export for Claude</button>
    </div>
    <div class="gym-log-list">${sessionsHtml}</div>
  ` : `
    <div class="gym-empty">
      <p>No sessions logged yet.</p>
      <p>Tap a strength day, then tap <strong>+ Log Session</strong>.</p>
    </div>
  `;

  section.innerHTML = weightCard + sessionsSection;
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
      return `  - ${ex.name}: ${w} (target: ${ex.target})`;
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
  render();
}

document.addEventListener('DOMContentLoaded', init);
