/**
 * Deterministic fictional demo data.
 *
 * Every person here is invented. The same anchor date always produces the same
 * records: there is no Math.random. The most recent four weeks of each person
 * are written by hand, because that is where the provisional triage rules look;
 * older history comes from a small seeded generator.
 *
 * The cohort is built to cover every triage outcome:
 *   RED    Tomás (fluctuating, no improvement), Daniel (flat at level 7)
 *   AMBER  Priya (missed tests), Aiko (recent not-felt), Leon (two rising readings)
 *   GREEN  Maya, Samuel, Noor (consistent, improving), Elin (new, little data)
 */
import { addDays, atLocalTime, type DateKey } from '../domain/dates';
import { DAILY_CHECK_IN } from '../domain/checkIn';
import { driveForLevel, isRehabLevel, levelStartMs } from '../domain/firmware';
import { DEFAULT_ESTIMATE_CONFIG } from '../domain/recoveryEstimate';
import { DEFAULT_TRIAGE_CONFIG } from '../domain/triage';
import type {
  CheckIn,
  CheckInAnswer,
  ClinicalSetup,
  ClinicianNote,
  ColdSensitivity,
  DemoState,
  Finger,
  Hand,
  Patient,
  Scenario,
  SensationTest,
  TriageFlag,
} from '../domain/types';

export const DEFAULT_PATIENT_ID = 'p-maya';

export const DEFAULT_SCENARIO: Scenario = {
  result: { kind: 'timed' },
  speed: 1,
  dropLinkOnNextTest: false,
  driverFault: false,
};

/** Scenario used by the guided judge demo: yesterday was step 5, today reports step 4. */
export const JUDGE_DEMO_SCENARIO: Scenario = {
  result: { kind: 'scripted', level: 4 },
  speed: 1,
  dropLinkOnNextTest: false,
  driverFault: false,
};

/** A felt step, 'N' = ran to the end and not felt, 'S' = cancelled, null = no test that day. */
export type Mark = number | 'N' | 'S' | null;
/** A day can hold more than one attempt. */
export type DayPlan = Mark | Mark[];

interface CheckInPlan {
  pain: number;
  skin?: boolean;
  skinNote?: string;
  cold?: ColdSensitivity;
  note?: string;
}

interface PatientPlan {
  id: string;
  demoId: string;
  name: string;
  hand: Hand;
  finger: Finger;
  repairDaysAgo: number;
  enrolledDaysAgo: number;
  clinical: ClinicalSetup;
  /** Usual time of the daily test, local. */
  testAt: [number, number];
  /** Usual time of the daily check-in, local. */
  checkInAt: [number, number];
  seed: number;
  /** Older history: step the pattern starts and ends at, and how much it wanders. */
  early: { from: number; to: number; wobble: number; missRate: number };
  /** The last days up to and including yesterday, oldest first. */
  recent: DayPlan[];
  /** Check-ins for the last days up to and including yesterday, oldest first. null = skipped. */
  recentCheckIns: (CheckInPlan | null)[];
  earlyPain: { from: number; to: number };
  earlyCold: ColdSensitivity;
  checkInMissRate: number;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Compact way to write a run of ordinary check-ins: pain values with one cold answer. */
function plain(pains: number[], cold: ColdSensitivity): CheckInPlan[] {
  return pains.map((pain) => ({ pain, cold }));
}

const PLANS: PatientPlan[] = [
  {
    // GREEN. Gradual downward pattern; one missed day, one not-felt day and one cancelled test in view.
    id: 'p-maya',
    demoId: 'Demo 01',
    name: 'Maya Okafor',
    hand: 'right',
    finger: 'index',
    repairDaysAgo: 68,
    enrolledDaysAgo: 62,
    clinical: { segment: 'middle', repairToTipMm: null },
    testAt: [18, 40],
    checkInAt: [21, 5],
    seed: 1101,
    early: { from: 9.4, to: 8, wobble: 1, missRate: 0.08 },
    recent: [
      8, 7, 8, 7, 7, 8, 7, 7, 'N', 7, 7, 6, 7, 7, 7, 6,
      7, 6, 7, 6, null, 6, 'N', 6, 5, 5, 'S', 5, 5, 5,
    ],
    recentCheckIns: [
      ...plain([3, 3, 2, 3], 'mild'),
      null,
      { pain: 2, cold: 'mild' },
      { pain: 3, cold: 'mild', note: 'Sleeve felt loose this morning.' },
      { pain: 2, cold: 'mild' },
      { pain: 2, cold: 'none', note: 'Typing at work felt easier today.' },
      { pain: 2, cold: 'mild' },
      { pain: 3, cold: 'mild' },
      { pain: 2, cold: 'mild' },
      { pain: 3, cold: 'moderate', note: 'Finger ached after a cold walk home.' },
      { pain: 2, cold: 'mild' },
    ],
    earlyPain: { from: 5, to: 3 },
    earlyCold: 'moderate',
    checkInMissRate: 0.08,
  },
  {
    // RED. Tests every day, results swing between 4 and 8, and the median has not moved in four weeks.
    // Also AMBER: reported pain jumped over the last two days.
    id: 'p-tomas',
    demoId: 'Demo 02',
    name: 'Tomás Reyes',
    hand: 'left',
    finger: 'middle',
    repairDaysAgo: 47,
    enrolledDaysAgo: 42,
    clinical: { segment: null, repairToTipMm: 62 },
    testAt: [7, 50],
    checkInAt: [20, 30],
    seed: 2202,
    early: { from: 7, to: 6, wobble: 2, missRate: 0.05 },
    recent: [
      6, 5, 7, 5, 6, 4, 7, 6, 5, 7, 6, 5, 6, 7,
      5, 7, 4, 6, 8, 5, 7, 4, 6, 5, 8, 6, 4, 7,
    ],
    recentCheckIns: [
      ...plain([2, 3, 2, 2, 3, 2, 2, 3, 2, 2, 3, 2], 'mild'),
      { pain: 5, cold: 'moderate', note: 'Sore after the gym.' },
      { pain: 6, cold: 'moderate', note: 'Throbbing most of the day, worse in the evening.' },
    ],
    earlyPain: { from: 4, to: 2 },
    earlyCold: 'mild',
    checkInMissRate: 0.08,
  },
  {
    // AMBER. Several missed days. No completed test for the last four days, check-ins lapsed too.
    id: 'p-priya',
    demoId: 'Demo 03',
    name: 'Priya Nair',
    hand: 'right',
    finger: 'ring',
    repairDaysAgo: 55,
    enrolledDaysAgo: 49,
    clinical: { segment: 'middle', repairToTipMm: null },
    testAt: [21, 10],
    checkInAt: [21, 20],
    seed: 3303,
    early: { from: 8, to: 7, wobble: 1, missRate: 0.3 },
    recent: [
      7, null, 6, 7, 6, null, 6, 7, null, 6, 6, null, 7, 6,
      6, 6, null, 5, null, 6, 5, null, null, 5, null, null, null, null,
    ],
    recentCheckIns: [
      { pain: 2, cold: 'mild' },
      { pain: 2, cold: 'mild' },
      null,
      { pain: 3, cold: 'mild' },
      null,
      { pain: 2, cold: 'mild' },
      { pain: 2, cold: 'none' },
      null,
      null,
      { pain: 2, cold: 'mild' },
      { pain: 3, cold: 'mild', note: 'Busy week, will catch up.' },
      null,
      null,
      null,
    ],
    earlyPain: { from: 4, to: 2 },
    earlyCold: 'mild',
    checkInMissRate: 0.3,
  },
  {
    // RED. Tests every day and has sat at level 6 to 7 for six weeks.
    // Also AMBER: yesterday's check-in reported a new skin issue.
    id: 'p-daniel',
    demoId: 'Demo 04',
    name: 'Daniel Whitlock',
    hand: 'left',
    finger: 'thumb',
    repairDaysAgo: 50,
    enrolledDaysAgo: 45,
    clinical: { segment: 'distal', repairToTipMm: null },
    testAt: [12, 30],
    checkInAt: [19, 45],
    seed: 4404,
    early: { from: 7, to: 7, wobble: 1, missRate: 0.04 },
    recent: [
      7, 7, 6, 7, 7, 7, 6, 7, 7, 7, 6, 7, 7, 7,
      7, 7, 6, 7, 7, 6, 7, 6, 7, 7, 6, 7, 7, 6,
    ],
    recentCheckIns: [
      ...plain([3, 3, 3, 2, 3, 3, 2, 3, 3, 2, 3, 3, 3], 'moderate'),
      { pain: 3, cold: 'moderate', skin: true, skinNote: 'Small blister where the edge of the sleeve sits.' },
    ],
    earlyPain: { from: 4, to: 3 },
    earlyCold: 'moderate',
    checkInMissRate: 0.05,
  },
  {
    // AMBER. Early days: detections only at the highest steps, and yesterday's test was not felt.
    id: 'p-aiko',
    demoId: 'Demo 05',
    name: 'Aiko Tanaka',
    hand: 'right',
    finger: 'little',
    repairDaysAgo: 22,
    enrolledDaysAgo: 18,
    clinical: { segment: 'proximal', repairToTipMm: null },
    testAt: [20, 0],
    checkInAt: [20, 10],
    seed: 5505,
    early: { from: 10, to: 10, wobble: 0, missRate: 0 },
    recent: ['N', 10, 'N', 'N', 10, 'N', 9, 10, 'N', 9, 10, 9, 'N', 10, 9, 9, 10, 'N'],
    recentCheckIns: [
      ...plain([5, 5, 4], 'severe'),
      { pain: 5, cold: 'moderate' },
      { pain: 4, cold: 'severe' },
      { pain: 4, cold: 'moderate' },
      { pain: 4, cold: 'severe' },
      ...plain([4, 3, 4], 'moderate'),
      { pain: 4, cold: 'severe' },
      ...plain([3, 4, 3], 'moderate'),
      { pain: 4, cold: 'moderate', note: 'Hard to tell what I am feeling some days.' },
      { pain: 4, cold: 'moderate' },
      { pain: 3, cold: 'moderate' },
      { pain: 4, cold: 'moderate' },
    ],
    earlyPain: { from: 5, to: 4 },
    earlyCold: 'severe',
    checkInMissRate: 0,
  },
  {
    // GREEN. Long history, tests almost every day, still edging down. One cancelled attempt followed by a completed test.
    id: 'p-samuel',
    demoId: 'Demo 06',
    name: 'Samuel Adeyemi',
    hand: 'left',
    finger: 'index',
    repairDaysAgo: 96,
    enrolledDaysAgo: 89,
    clinical: { segment: null, repairToTipMm: 48 },
    testAt: [8, 20],
    checkInAt: [8, 30],
    seed: 6606,
    early: { from: 8.4, to: 5.2, wobble: 1, missRate: 0.06 },
    recent: [
      5, 5, 4, 5, 5, 5, 4, 5, 5, 4, 5, 5, 5, 4,
      4, 4, 5, 4, 4, 3, 4, ['S', 4], 4, 5, 4, 4, 4, 4,
    ],
    recentCheckIns: [
      ...plain([1, 1, 2, 1, 1], 'mild'),
      { pain: 5, cold: 'mild', note: 'Overdid it in the garden.' },
      ...plain([2, 1, 1, 1, 2, 1, 1, 1], 'none'),
    ],
    earlyPain: { from: 4, to: 1 },
    earlyCold: 'mild',
    checkInMissRate: 0.05,
  },
  {
    // GREEN. Enrolled this week. Very little data yet.
    id: 'p-elin',
    demoId: 'Demo 07',
    name: 'Elin Marsh',
    hand: 'right',
    finger: 'middle',
    repairDaysAgo: 10,
    enrolledDaysAgo: 3,
    clinical: { segment: null, repairToTipMm: null },
    testAt: [19, 15],
    checkInAt: [19, 25],
    seed: 7707,
    early: { from: 9, to: 9, wobble: 0, missRate: 0 },
    recent: [9, 8, 9],
    recentCheckIns: [
      { pain: 4, cold: 'moderate' },
      { pain: 4, cold: 'moderate', note: 'Getting used to wearing the sleeve.' },
      { pain: 3, cold: 'moderate' },
    ],
    earlyPain: { from: 4, to: 4 },
    earlyCold: 'moderate',
    checkInMissRate: 0,
  },
  {
    // AMBER. Steady around step 6, then the last two readings rose to 8 and 9.
    id: 'p-leon',
    demoId: 'Demo 08',
    name: 'Leon Fischer',
    hand: 'left',
    finger: 'ring',
    repairDaysAgo: 29,
    enrolledDaysAgo: 24,
    clinical: { segment: null, repairToTipMm: 35 },
    testAt: [22, 5],
    checkInAt: [22, 15],
    seed: 8808,
    early: { from: 7, to: 7, wobble: 0, missRate: 0 },
    recent: [7, 6, 7, 6, 6, 7, 6, 6, null, 6, 6, 6, 5, 6, 6, null, 6, 5, 6, 6, 6, 6, 8, 9],
    recentCheckIns: [
      ...plain([3, 3, 2, 3, 2, 2, 3, 2, 2, 2, 3, 2], 'mild'),
      { pain: 3, cold: 'mild', note: 'New work gloves, sleeve sits differently.' },
      { pain: 3, cold: 'mild' },
    ],
    earlyPain: { from: 4, to: 3 },
    earlyCold: 'mild',
    checkInMissRate: 0.05,
  },
  {
    // GREEN. Consistent testing, steady downward pattern.
    id: 'p-noor',
    demoId: 'Demo 09',
    name: 'Noor Haddad',
    hand: 'right',
    finger: 'thumb',
    repairDaysAgo: 46,
    enrolledDaysAgo: 40,
    clinical: { segment: 'distal', repairToTipMm: null },
    testAt: [9, 10],
    checkInAt: [9, 20],
    seed: 9909,
    early: { from: 9, to: 8, wobble: 1, missRate: 0.05 },
    recent: [
      8, 8, 7, 8, 7, 8, 7, 7, 8, 7, 7, 7, 8, 7,
      7, 7, 6, 7, 6, 7, 6, 6, 7, 6, 6, 6, 5, 6,
    ],
    recentCheckIns: plain([2, 2, 3, 2, 2, 2, 1, 2, 2, 2, 1, 2, 2, 1], 'mild'),
    earlyPain: { from: 4, to: 2 },
    earlyCold: 'moderate',
    checkInMissRate: 0.05,
  },
];

export function makeSeedTest(
  patientId: string,
  day: DateKey,
  at: [number, number],
  mark: Exclude<Mark, null>,
  attempt: number,
  jitter: number,
  source: SensationTest['source'] = 'seed',
): SensationTest {
  const timestamp = atLocalTime(day, at[0], at[1] + attempt * 4);
  const base = {
    id: `${source}-${patientId}-${day}-${attempt}`,
    patientId,
    timestamp,
    simulated: true as const,
    source,
  };
  if (mark === 'N') {
    return { ...base, outcome: 'NO_FELT', detectedLevel: null, commandedRtp: null, elapsedMs: null };
  }
  if (mark === 'S') {
    return {
      ...base,
      outcome: 'STOPPED',
      detectedLevel: null,
      commandedRtp: null,
      elapsedMs: null,
      stopReason: 'USER_STOP',
    };
  }
  const level = clamp(Math.round(mark), 1, 10);
  if (!isRehabLevel(level)) throw new Error(`Seed produced an invalid level: ${mark}`);
  return {
    ...base,
    outcome: 'FELT',
    detectedLevel: level,
    commandedRtp: driveForLevel(level),
    // A plausible moment inside that level's three-second window.
    elapsedMs: levelStartMs(level) + 600 + Math.round(jitter * 1_800),
  };
}

function makeCheckIn(patientId: string, day: DateKey, at: [number, number], plan: CheckInPlan): CheckIn {
  const answers: Record<string, CheckInAnswer> = {
    pain: plan.pain,
    skin: plan.skin ?? false,
    cold: plan.cold ?? 'none',
  };
  if (plan.skin && plan.skinNote) answers.skinNote = plan.skinNote;
  if (plan.note) answers.note = plan.note;
  return {
    id: `seed-ci-${patientId}-${day}`,
    patientId,
    date: day,
    schemaId: DAILY_CHECK_IN.id,
    answers,
    updatedAt: atLocalTime(day, at[0], at[1]),
  };
}

function buildPatient(plan: PatientPlan, anchor: DateKey): Patient {
  return {
    id: plan.id,
    demoId: plan.demoId,
    name: plan.name,
    firstName: plan.name.split(' ')[0],
    hand: plan.hand,
    finger: plan.finger,
    injury: 'Digital nerve repair',
    repairDate: addDays(anchor, -plan.repairDaysAgo),
    enrolledDate: addDays(anchor, -plan.enrolledDaysAgo),
    clinical: { ...plan.clinical },
    fictional: true,
  };
}

function buildRecords(plan: PatientPlan, anchor: DateKey): { tests: SensationTest[]; checkIns: CheckIn[] } {
  const random = mulberry32(plan.seed);
  const tests: SensationTest[] = [];
  const checkIns: CheckIn[] = [];

  const recentCount = plan.recent.length;
  const earlyCount = Math.max(0, plan.enrolledDaysAgo - recentCount);

  // Older history, generated.
  for (let index = 0; index < earlyCount; index += 1) {
    const day = addDays(anchor, -plan.enrolledDaysAgo + index);
    const progress = earlyCount > 1 ? index / (earlyCount - 1) : 1;
    const centre = plan.early.from + (plan.early.to - plan.early.from) * progress;
    const roll = random();
    const wobble = roll < 0.28 ? -plan.early.wobble : roll > 0.72 ? plan.early.wobble : 0;
    const raw = Math.round(centre + wobble);
    const missed = random() < plan.early.missRate;
    const jitter = random();

    if (!missed) {
      // Near the top of the range, some runs end without a response.
      const mark: Exclude<Mark, null> = raw > 10 || (raw === 10 && random() < 0.45) ? 'N' : clamp(raw, 1, 10);
      tests.push(makeSeedTest(plan.id, day, plan.testAt, mark, 0, jitter));
    }

    if (random() >= plan.checkInMissRate) {
      const pain = clamp(
        Math.round(plan.earlyPain.from + (plan.earlyPain.to - plan.earlyPain.from) * progress + (random() - 0.5) * 1.6),
        0,
        10,
      );
      checkIns.push(makeCheckIn(plan.id, day, plan.checkInAt, { pain, cold: plan.earlyCold }));
    }
  }

  // The recent stretch, written by hand. It ends yesterday so that today starts open.
  plan.recent.forEach((dayPlan, index) => {
    const day = addDays(anchor, -(recentCount - index));
    const marks = Array.isArray(dayPlan) ? dayPlan : [dayPlan];
    marks.forEach((mark, attempt) => {
      if (mark !== null) tests.push(makeSeedTest(plan.id, day, plan.testAt, mark, attempt, random()));
    });
  });

  // Days between the generated history and the hand-written check-ins get ordinary entries.
  const handWritten = plan.recentCheckIns.length;
  for (let offset = recentCount; offset > handWritten; offset -= 1) {
    if (offset > plan.enrolledDaysAgo) continue;
    if (random() < plan.checkInMissRate) continue;
    const day = addDays(anchor, -offset);
    const pain = clamp(Math.round(plan.earlyPain.to + (random() - 0.5) * 1.6), 0, 10);
    checkIns.push(makeCheckIn(plan.id, day, plan.checkInAt, { pain, cold: plan.earlyCold }));
  }

  plan.recentCheckIns.forEach((entry, index) => {
    if (!entry) return;
    const day = addDays(anchor, -(handWritten - index));
    checkIns.push(makeCheckIn(plan.id, day, plan.checkInAt, entry));
  });

  // Hand-written check-ins win over generated ones for the same day.
  const byDay = new Map<string, CheckIn>();
  for (const entry of checkIns) byDay.set(entry.date, entry);

  return {
    tests: tests.sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    checkIns: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function seedFlagLog(anchor: DateKey): TriageFlag[] {
  const reportedOn = addDays(anchor, -9);
  return [
    {
      id: `p-samuel|PAIN_INCREASE|${reportedOn}`,
      patientId: 'p-samuel',
      ruleId: 'PAIN_INCREASE',
      level: 'AMBER',
      condition:
        'The latest pain score, reported in the last 3 days, is 3 or more points above the median of the previous 7 days (at least 3 check-ins).',
      evidence: 'Pain reported as 5/10. Median of the previous 7 days: 1/10 (7 check-ins).',
      raisedOn: reportedOn,
      status: 'reviewed',
      reviewedAt: atLocalTime(addDays(anchor, -8), 9, 40),
      note: 'Discussed by phone: a day of gardening. Settled by the next check-in. No change to plan. (Demo note)',
    },
  ];
}

function seedNotes(anchor: DateKey): ClinicianNote[] {
  return [
    {
      id: 'seed-note-maya-1',
      patientId: 'p-maya',
      createdAt: atLocalTime(addDays(anchor, -10), 11, 15),
      text: 'Clinic visit. Sleeve refitted; reminded to rest the finger lightly and keep the same position for each test. (Demo note)',
    },
    {
      id: 'seed-note-samuel-1',
      patientId: 'p-samuel',
      createdAt: atLocalTime(addDays(anchor, -8), 9, 42),
      text: 'Pain report followed up by phone. See review history. (Demo note)',
    },
    {
      id: 'seed-note-priya-1',
      patientId: 'p-priya',
      createdAt: atLocalTime(addDays(anchor, -12), 14, 5),
      text: 'Finds the evening test hard to fit in around shifts. Suggested trying mornings. (Demo note)',
    },
  ];
}

/** Build a complete, reproducible demo state for the given calendar day. */
export function createSeedState(anchor: DateKey, scenario: Scenario = DEFAULT_SCENARIO): DemoState {
  const patients = PLANS.map((plan) => buildPatient(plan, anchor));
  const tests: SensationTest[] = [];
  const checkIns: CheckIn[] = [];
  for (const plan of PLANS) {
    const records = buildRecords(plan, anchor);
    tests.push(...records.tests);
    checkIns.push(...records.checkIns);
  }

  return {
    version: 2,
    anchorDate: anchor,
    activePatientId: DEFAULT_PATIENT_ID,
    patients,
    tests,
    checkIns,
    flagLog: seedFlagLog(anchor),
    clinicianFlags: [],
    clinicianNotes: seedNotes(anchor),
    triageConfig: structuredClone(DEFAULT_TRIAGE_CONFIG),
    estimateConfig: structuredClone(DEFAULT_ESTIMATE_CONFIG),
    scenario: { ...scenario },
    // A freshly powered device starts in Normal mode (STATUS,NORMAL,0).
    device: { linkUp: true, mode: 'NORMAL' },
    deviceLog: [],
    assistPreferred: true,
    onboardingSeen: false,
  };
}

// ---------- Recovery-history presets for the demo controller ----------

export type HistoryPreset = 'improving' | 'plateau' | 'fluctuating' | 'early';

export const HISTORY_PRESET_LABEL: Record<HistoryPreset, { title: string; detail: string }> = {
  improving: { title: 'Steady downward pattern', detail: 'Level 9 easing to level 5 over five weeks, tested most days.' },
  plateau: { title: 'Flat for five weeks', detail: 'Level 7 throughout, tested every day. Meets the provisional priority-review rule.' },
  fluctuating: { title: 'Fluctuating', detail: 'Swings between level 4 and level 8 with no overall change.' },
  early: { title: 'Early recovery', detail: 'Mostly not felt, with occasional detections at levels 9 and 10.' },
};

/** Thirty-five days ending yesterday, oldest first. */
const HISTORY_PRESETS: Record<HistoryPreset, Mark[]> = {
  improving: [
    9, 9, 'N', 9, 8, 9, 8, 8, 9, 8, 8, null, 8, 7, 8, 7, 7, 8, 7, 7, 6, 7, 7, 6, 6, 7, 6, 6, 5, 6, null, 6, 5, 5, 5,
  ],
  plateau: [
    7, 7, 7, 6, 7, 7, 7, 7, 6, 7, 7, 7, 7, 7, 6, 7, 7, 7, 7, 6, 7, 7, 7, 7, 7, 6, 7, 7, 7, 6, 7, 7, 7, 7, 7,
  ],
  fluctuating: [
    6, 4, 7, 5, 8, 6, 4, 7, 5, 6, 8, 4, 6, 7, 5, 4, 8, 6, 5, 7, 4, 6, 8, 5, 7, 4, 6, 5, 8, 6, 4, 7, 5, 8, 6,
  ],
  early: [
    'N', 'N', 10, 'N', 'N', 'N', 10, 'N', 9, 'N', 'N', 10, 'N', 10, 'N', 'N', 9, 10, 'N', 10, 'N', 9, 'N', 10, 10, 'N', 9,
    10, 'N', 9, 10, 9, 'N', 10, 9,
  ],
};

/** Replacement test history for one person, ending yesterday. Used by the demo controller only. */
export function presetHistory(patientId: string, preset: HistoryPreset, anchor: DateKey): SensationTest[] {
  const marks = HISTORY_PRESETS[preset];
  const random = mulberry32(marks.length * 97 + preset.length);
  const tests: SensationTest[] = [];
  marks.forEach((mark, index) => {
    if (mark === null) return;
    const day = addDays(anchor, -(marks.length - index));
    tests.push(makeSeedTest(patientId, day, [18, 30], mark, 0, random(), 'demo-panel'));
  });
  return tests;
}

export const PRESET_HISTORY_DAYS = HISTORY_PRESETS.improving.length;
