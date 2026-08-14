// Plan constants. These mirror group-rides.md and the Phase 1-3 handoff.
// Everything here is fact about the plan, not user data.

export const TIMEZONE = 'America/New_York';

export const GOOGLE_CLIENT_ID = import.meta.env?.VITE_GOOGLE_CLIENT_ID ?? '';
export const CALENDAR_ID = import.meta.env?.VITE_CALENDAR_ID ?? '';
export const WORKER_URL = (import.meta.env?.VITE_WORKER_URL ?? '').replace(/\/$/, '');

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

// --- 16-week build ---------------------------------------------------------
// Block 1 Week 1 starts Monday 17 Aug 2026.
export const PLAN_START = '2026-08-17';

export const BLOCKS = [
  { n: 1, name: 'Consistency', weeks: [1, 4], floor: 120, target: 140, runTarget: [4, 6, 8, 10] },
  { n: 2, name: 'Base', weeks: [5, 8], floor: 150, target: 165, runTarget: [10, 10, 10, 10] },
  { n: 3, name: 'Build', weeks: [9, 12], floor: 170, target: 185, runTarget: [10, 10, 10, 10] },
  { n: 4, name: 'Target', weeks: [13, 16], floor: 185, target: 200, runTarget: [10, 10, 10, 10] },
];

// Every 4th week of a block drops ~30% in volume while holding frequency.
export const RECOVERY_WEEK_OF_BLOCK = 4;
export const RECOVERY_MULTIPLIER = 0.7;

// --- Transit ---------------------------------------------------------------
export const PARKS = {
  central: { name: 'Central Park', oneWayMi: 6.0, oneWayMin: 26, loopMi: 6.02 },
  prospect: { name: 'Prospect Park', oneWayMi: 4.0, oneWayMin: 16, loopMi: 3.35 },
};

export const SPEEDS = { transit: 15, rpe2: 13, rpe3: 16, rpe34: 17 };

// --- Work schedule ---------------------------------------------------------
export const WORK = {
  officeDays: [1, 2, 4], // Mon, Tue, Thu
  wfhDays: [3, 5], // Wed, Fri
  latestArrival: '09:30',
  normalArrival: '09:00',
  commuteWalkMin: 30,
  commuteCitiBikeMin: 10,
  bufferStandardMin: 45,
  bufferCompressedMin: 30,
  // Latest you can be home from a morning ride on an office day.
  latestHomeCitiBike: '08:35',
  latestHomeCeiling: '08:50',
  citiBikeBudgetPerWeek: 2,
};

// --- Group rides -----------------------------------------------------------
// Detection is by title. Never by colorId — 6 does double duty for group rides
// and the Sunday priority session.
export const GROUP_RIDE_TITLES = [
  'Duck Fleet Recovery Laps',
  'Duck Fleet Coffee Laps',
  'Good Guys Night Laps',
  'Rapha Thursday Night Delight',
  'Rapha Tuesday Sunset',
  'Rapha Mid Week Shuffle',
];

export const SOLO_SESSION_TITLES = [
  'Easy Ride',
  'Recovery Spin',
  'Endurance Ride',
  'Long Ride',
  'Sunday Ride',
  'Easy Run',
];

export const SESSION_TITLES = [...GROUP_RIDE_TITLES, ...SOLO_SESSION_TITLES];

export const GROUP_RIDES = {
  'Duck Fleet Recovery Laps': {
    day: 1, groupStart: '06:25', park: 'central', doorToDoor: 30, lapMi: 18, laps: 3,
    rpe: [3, 3], band: 'easy', rollOut: '05:55', wake: '05:30', bedtimeBefore: '22:00',
    status: 'most-weeks', needsCitiBike: true,
  },
  'Good Guys Night Laps': {
    day: 2, groupStart: '20:00', park: 'alternates', doorToDoor: 39, lapMi: 27,
    rpe: [7, 8], band: 'hard', rollOut: '19:10', leaveWork: '17:45',
    status: 'always',
  },
  'Rapha Thursday Night Delight': {
    day: 4, groupStart: '18:45', park: 'central', doorToDoor: 36, lapMi: 24, laps: 4,
    rpe: [5, 6], band: 'tempo', rollOut: '18:10', leaveWork: '17:30',
    status: 'rotates-with-friday',
  },
  'Duck Fleet Coffee Laps': {
    day: 5, groupStart: '05:55', park: 'central', doorToDoor: 38, lapMi: 26, laps: 4,
    rpe: [5, 6], band: 'tempo', rollOut: '05:29', wake: '05:05', bedtimeBefore: '21:35',
    status: 'rotates-with-thursday', needsCitiBike: false, // Friday is WFH
  },
  'Rapha Tuesday Sunset': {
    day: 2, groupStart: '18:15', park: 'central', doorToDoor: 40, lapMi: 28,
    rpe: [6, 7], band: 'tempo', rollOut: '17:40',
    status: 'good-guys-substitute-only',
  },
  'Rapha Mid Week Shuffle': {
    day: 3, groupStart: '05:40', park: 'central', doorToDoor: 38, lapMi: 26, laps: 4,
    rpe: [5, 6], band: 'tempo', rollOut: '05:10', wake: '04:45',
    status: 'never', blockedReason: 'Sleep, not work. 4:45am wake after a 10:45pm post-Good-Guys bedtime is six hours before a tempo session.',
  },
};

// Good Guys alternates parks. 11 Aug 2026 was Prospect.
export const GOOD_GUYS_ANCHOR = { date: '2026-08-11', park: 'prospect' };

// --- Intensity -------------------------------------------------------------
export const BANDS = {
  easy: { label: 'Easy', rpe: '2-4' },
  tempo: { label: 'Tempo', rpe: '5-6' },
  hard: { label: 'Hard', rpe: '7-9' },
  run: { label: 'Run', rpe: '-' },
};

// 80/20 guide. Week 1 runs 47%; the app shows the gap rather than hiding it.
export const HARD_SHARE_GUIDE = 0.2;
