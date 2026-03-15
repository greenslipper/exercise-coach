# Coaching Principles

Reference document for how Claude approaches 5K training plans.

---

## Training Philosophy

### 80/20 Easy/Hard Split
- Approximately 80% of weekly volume at easy/conversational pace (Zone 2)
- 20% at harder intensities (tempo, intervals, strides)
- Easy runs should feel genuinely easy — if you can't hold a conversation, slow down
- Most recreational runners run too hard on easy days, which impairs recovery

### Progressive Overload
- Increase weekly volume by no more than 10% per week
- After every 3 weeks of building, schedule a recovery week (~70% of peak volume)
- Intensity increases separately from volume — don't increase both in the same week

---

## 5K Training Plan Structure

### Typical 8–12 Week Plan Phases

**Base Phase (weeks 1–3)**
- Goal: establish aerobic base, build consistent habit
- All runs at easy pace
- Total weekly volume modest and achievable

**Build Phase (weeks 4–8)**
- Introduce one quality session per week (tempo or intervals)
- Gradually increase long run distance
- Monitor fatigue — back off if needed

**Peak Phase (weeks 9–10)**
- Highest volume week
- One or two tune-up races or time trials if available

**Taper Phase (final 1–2 weeks)**
- Reduce volume by 30–40%
- Maintain some intensity to stay sharp
- Prioritize sleep, nutrition, rest

---

## Key Workout Types

### Easy Run
- Pace: comfortable, conversational
- Purpose: aerobic development, recovery, building volume
- How to tell: you could recite a sentence without gasping

### Long Run
- Longest run of the week, at easy pace
- For 5K training: typically 6–10km depending on current fitness
- Builds aerobic capacity and mental toughness

### Tempo Run
- "Comfortably hard" — you can speak a few words but not hold a conversation
- Typically 20–40 minutes at threshold pace
- Builds lactate threshold, the key to faster 5K times

### Intervals
- Short, fast efforts with recovery jogs between
- e.g. 6 × 400m at faster than 5K pace, 90s jog recovery
- Builds VO2max and running economy
- Don't add intervals until base is established (4+ weeks in)

### Strides
- 4–6 × 20-second relaxed accelerations at the end of an easy run
- Maintains leg turnover without adding significant fatigue
- Good during taper weeks

---

## Reading Strava Data

When analyzing activity JSON files, look for:

- **`average_speed`** (m/s) → convert to min/km: `1000 / (speed * 60)`
- **`average_heartrate`** / **`max_heartrate`**: effort indicator
- **`suffer_score`**: Strava's relative effort metric
- **`perceived_exertion`**: athlete's RPE (1–10) if logged
- **`workout_type`**: 0=default, 1=race, 2=long run, 3=workout
- **`start_date_local`**: when the run happened
- **`distance`** (meters), **`moving_time`** (seconds), **`elapsed_time`** (seconds)
- **`total_elevation_gain`** (meters)
- **`splits_metric`**: per-km pace breakdown — great for seeing even vs uneven pacing
- **`laps`**: per-lap breakdown — essential for interval sessions (see below)

### Always Check Laps Before Interpreting a Run

**Never draw conclusions from average pace or average HR alone.** These are meaningless for any session with variable effort — intervals, fartlek, walk recoveries. A pyramid session with walking recoveries can show an "average pace" of 4:30/km and "average HR" of 160 that looks like a threshold run but is nothing of the sort.

**Before assessing effort or fitness, check whether `laps` data exists and read it.**

#### Reading the laps array

Each lap has: `distance` (m), `moving_time` (s), `average_speed` (m/s), `average_heartrate`, `pace_zone`.

Convert speed to pace: `1000 / (speed × 60)` = min/km.

#### Identifying session type from laps

| Pattern | Session type |
|---------|-------------|
| One long lap, steady pace/HR | Continuous easy or tempo run |
| Alternating fast/slow laps | Interval session |
| Durations 60s→120s→180s→... | Pyramid session |
| First lap slow, last lap slow, fast in between | Warmup/interval/cooldown structure |

#### Extracting fitness data from interval laps

- **Longest fast rep** gives the best estimate of sustained VO2max-range effort
- **Shortest fast reps** show top-end speed (anaerobic / R-pace)
- Use the longest rep pace to anchor training zones; don't use average pace across the whole session
- Recovery laps (slow pace, pace zone 1) confirm it's an interval session, not a tempo run

### Patterns to Notice
- Paces much faster than easy threshold: runner going too hard on recovery days
- High HR on easy runs: accumulated fatigue or poor heat/hydration conditions
- Declining pace over weeks at same HR: improving fitness
- Missed workouts or gaps: ask about what happened, adjust plan

---

## Functional Strength Training

### Purpose

Strength work for Freddie is injury prevention first, performance second. Given his Achilles tendinopathy history, the priority is building the posterior chain (calf, soleus, glutes, hamstrings) and single-leg stability. Full gym access available.

### Schedule

Two sessions per week, on easy running days (Tuesday and Thursday). Run first, strength after. Keep well away from quality running sessions (intervals, tempo, race).

During taper: drop to one session in Week 4, very light. Race week: one light session Tuesday only, nothing after.

### Session A — Posterior Chain & Achilles (Tuesday)

| Exercise | Sets × Reps | Notes |
|----------|-------------|-------|
| Barbell Romanian Deadlift | 3 × 8 | Hip hinge, flat back, feel hamstrings load |
| Barbell Hip Thrust | 3 × 10 | Full hip extension at top, squeeze glutes |
| Nordic Hamstring Curl | 3 × 6 | Eccentric focus — lower slowly, use hands to return |
| Seated Calf Raise (machine) | 3 × 15 | 3s down, 1s up — targets soleus directly |
| Eccentric Heel Drop (single leg, on step) | 3 × 15 each | 3s down off step edge — Achilles rehab gold standard |

~35 min. Rest 90s between sets.

### Session B — Single-Leg Stability & Hip (Thursday)

| Exercise | Sets × Reps | Notes |
|----------|-------------|-------|
| Bulgarian Split Squat (dumbbells) | 3 × 8 each | Rear foot elevated, knee tracks over toes |
| Single-Leg RDL (dumbbell) | 3 × 8 each | Balance + posterior chain; controls asymmetry |
| Copenhagen Adduction | 2 × 10 each | Side plank variation, inside leg on bench |
| Standing Calf Raise (machine) | 3 × 15 | Targets gastrocnemius; 3s eccentric |
| Dead Bug | 2 × 12 each | Press lower back into floor throughout |

~35 min. Rest 90s between sets.

### Periodisation

| Phase | Load | Change |
|-------|------|--------|
| Weeks 1–2 (Build) | Moderate | Form focus, 3 sets, controlled tempo |
| Week 3 (Peak) | Heavier | Progress main lifts 5–10%, keep calf/Achilles work same |
| Week 4 (Taper) | Light | Session A only, drop to 2 sets, reduce weight 20% |
| Race week | Very light | Session A Tuesday only, 1 set each, no DOMS risk |

### Key rules

- **Never train strength the day before a quality run** — sore legs compromise intervals and tempos
- **Eccentric heel drops are non-negotiable** — maintain these through taper and race week; they are the Achilles protocol
- **If Achilles feels tight after a session**, drop the calf work volume next session, not the running
- Strength sessions should leave Freddie feeling worked but not wrecked — reduce load if soreness persists >48h

---

## Recovery Signals

### Signs of Good Recovery
- Resting HR stable or trending down
- Easy runs feel easier over time
- Sleep quality good
- Mood positive, motivated

### Warning Signs (back off training)
- Persistent muscle soreness > 48h after easy runs
- Elevated resting HR (>5–7 bpm above baseline)
- Declining performance despite consistent training
- Loss of motivation, heavy legs, frequent illness
- User reports feeling "off" or overly tired

### Response to Fatigue
- Swap a workout for an easy run
- Add an extra rest day
- Reduce weekly volume by 20–30% for one week
- Never push through fatigue to hit a planned session

---

## Coaching Communication Style

- Be specific: give exact paces or effort levels for each workout
- Be encouraging but honest about what the data shows
- When adapting the plan, explain *why* so Freddie learns
- Keep plans realistic — a plan that gets followed beats a perfect plan that doesn't
- Ask questions when data is ambiguous rather than assuming

---

## 5K-Specific Learnings (from Runna plan comparison, 2026-03-14)

### Long Runs Should Be Longer Than You Think

For an experienced runner targeting sub-17:00 5K, the long run should peak at **14–16 km**, not 8–10 km. The long run builds the aerobic engine that makes the last kilometre of a 5K possible. Undercooking it leaves aerobic capacity as a limiter, even if the speed work is dialled in.

### Structure Long Runs With Race Pace Sections

In the build phase, the long run shouldn't just be easy throughout. Embedding a **race pace section in the middle** (e.g. 5 km aerobic → 2–3 km @ race pace → 5 km aerobic) is more specific preparation than an easy long run. The athlete arrives at race pace fatigued, which is exactly the training stimulus — learning to sustain goal pace when not fresh.

### VO2max Intervals Must Be Genuinely Above Race Pace

If race pace is 3:24/km, running 1km reps at 3:25–3:30/km provides almost no VO2max stimulus — it's barely harder than race pace. **VO2max reps should be at 3:14–3:18/km** (10 sec/km above race pace). The discomfort of truly supramaximal running is where VO2max adaptations happen. Use generous recovery (3 min jog) between reps so each one can be run at full quality.

### Short Speed Reps (400m) With Walk Recovery

**Repetition-pace training** (400m reps at well above race pace, e.g. 2:53/km with 90s walk recovery) develops neuromuscular power and running economy. Walk recovery — not jog — between reps allows full recovery so each rep can be run at the same quality. This format is actually less calf-stressing than sustained tempo because each rep is only ~70 seconds. Goal is identical splits across all reps, not a fast early rep.

### Keep One Quality Session in the Taper Week

Removing all quality in the taper risks leaving legs flat and slow on race day. A short tune-up session in the taper week — e.g. **3 × 1 km at race pace** — maintains neuromuscular sharpness without accumulating meaningful fatigue. It should feel controlled, not hard. If legs feel flat during it, that's normal taper tiredness; they'll be sharp on race day.

### Race Week: Keep Legs Firing With Short Structured Reps

Easy running alone in race week is not enough to keep the legs primed. A short structured session on Tuesday (e.g. **8 × 90s at race pace**, 4 days before the race) maintains the legs' ability to fire at speed. The format is low fatigue (short warmup/cooldown, short reps, adequate recovery) but high specificity. The subsequent rest days fully compensate.

### Add Strides the Day Before a Race

A very easy 20-minute jog + 4 strides the day before the race (not just total rest) activates the nervous system and prevents legs from feeling heavy at the start. It should feel effortless — if it doesn't, back off.

### Cruise Interval Progressions (Ladder Format)

Sessions that layer progressively shorter reps at progressively faster paces (e.g. 4 min @ 3:42 → 2 × 3 min @ 3:32 → 3 × 2 min @ 3:24) build lactate threshold while teaching the body to sustain effort through pace transitions. More sophisticated than flat-pace intervals of the same rep length. Good for the first quality session back after injury/recovery.
