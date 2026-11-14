/**
 * Shared domain types for the Ntact prototype.
 *
 * Everything here is fictional demonstration data. Nothing in this file is a
 * clinical data model; it mirrors what the V3 firmware can actually report,
 * plus provisional product decisions that are marked as such.
 */

// ---------- Device ----------

export type DeviceMode = 'IDLE' | 'NORMAL' | 'REHAB';

export type ConnectionState = 'connected' | 'disconnected' | 'connecting' | 'error';

/** The only words the V3 firmware accepts on the RX characteristic. */
export type DeviceCommand = 'STATUS' | 'NORMAL' | 'REHAB' | 'START' | 'FELT' | 'STOP';

/** Rehab levels that carry a stimulus. Level 0 is the silent first second and is never a result. */
export type RehabLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type DeviceErrorCode = 'SELECT_REHAB' | 'DRIVER' | 'NO_TEST';

/** Parsed form of one TX notification. `raw` strings never reach the screens. */
export type DeviceEvent =
  | { type: 'STATUS'; mode: DeviceMode; level: number }
  | { type: 'NORMAL_READY' }
  | { type: 'REHAB_READY' }
  | { type: 'LEVEL'; level: number; drive: number }
  | { type: 'FELT'; level: number; drive: number; elapsedMs: number }
  | { type: 'STOPPED' }
  | { type: 'COMPLETE_NO_FELT' }
  | { type: 'ERR'; code: DeviceErrorCode | string }
  | { type: 'UNKNOWN'; raw: string };

// ---------- Sensation test ----------

export type TestOutcome = 'FELT' | 'NO_FELT' | 'STOPPED';

/**
 * Where a record came from.
 *
 * 'ble' is the only source that involves the physical wearable: the outcome was
 * reported by the ESP32 over Bluetooth. Every other source is the demonstration.
 */
export type TestSource = 'seed' | 'mock-timed' | 'mock-scripted' | 'demo-panel' | 'ble';

/**
 * The injured site a test was run on, captured when the test started. The current
 * hardware tests one finger at a time, so there is exactly one site per record.
 */
export interface TestSite {
  hand: Hand;
  finger: Finger;
}

/**
 * USER_STOP: the patient (or the app, on leaving the screen) sent STOP.
 * EARLY_RESPONSE: the patient tapped during the silent first second, before any
 * vibration was commanded, so there is nothing to report.
 */
export type StopReason = 'USER_STOP' | 'EARLY_RESPONSE';

interface TestBase {
  id: string;
  patientId: string;
  /** ISO timestamp. */
  timestamp: string;
  /** false only when the outcome was reported by the physical wearable (`source: 'ble'`). */
  simulated: boolean;
  source: TestSource;
  /**
   * Which finger was tested. Absent on older and seeded records, where it is the
   * patient's recorded injury site. Present on every test run from the app, so a
   * later multi-finger build can tell records apart without a migration.
   */
  site?: TestSite;
}

export interface FeltTest extends TestBase {
  outcome: 'FELT';
  /** Level the device reported in `FELT,<level>,<drive>,<elapsed_ms>`. */
  detectedLevel: RehabLevel;
  /** Requested DRV2605L RTP value. A command setting, not an amplitude or a percentage. */
  commandedRtp: number;
  elapsedMs: number;
}

export interface NoFeltTest extends TestBase {
  outcome: 'NO_FELT';
  detectedLevel: null;
  commandedRtp: null;
  elapsedMs: null;
}

export interface StoppedTest extends TestBase {
  outcome: 'STOPPED';
  detectedLevel: null;
  commandedRtp: null;
  elapsedMs: null;
  stopReason: StopReason;
}

/**
 * NO_FELT and STOPPED are separate members on purpose: neither is ever stored as
 * step 0, step 11 or any other number that could be mistaken for a detection.
 */
export type SensationTest = FeltTest | NoFeltTest | StoppedTest;

/** What a finished trial produced, before it is turned into a stored record. */
export type TrialOutcome =
  | { outcome: 'FELT'; level: RehabLevel; drive: number; elapsedMs: number }
  | { outcome: 'NO_FELT' }
  | { outcome: 'STOPPED'; stopReason: StopReason };

// ---------- Guided exercises ----------

export type ExerciseId = 'open-close';

/**
 * camera: tracked from this device's camera. The only source that is not simulated.
 * demo-motion: the built-in animated hand, for showing the screen without a camera.
 * seed / demo-panel: example history.
 */
export type ExerciseSource = 'camera' | 'demo-motion' | 'seed' | 'demo-panel';

/**
 * One guided exercise session.
 *
 * The three angle fields are CAMERA ESTIMATES for the injured finger: the three
 * joints added together, typically within 10 to 20 degrees of the truth and worse
 * when the hand is turned. They exist to show a trend. They are not goniometry.
 */
export interface ExerciseSession {
  id: string;
  patientId: string;
  /** ISO timestamp. */
  timestamp: string;
  exerciseId: ExerciseId;
  reps: number;
  targetReps: number;
  /** True when the target number of repetitions was reached. */
  completed: boolean;
  durationMs: number;
  /** The finger the estimates refer to, captured when the session started. */
  site: TestSite;
  /** Typical peak bend, degrees. null when no repetition was counted. */
  flexDeg: number | null;
  /** Typical bend remaining with the hand open, degrees. */
  extDeg: number | null;
  /** The arc moved through: flexDeg minus extDeg. */
  rangeDeg: number | null;
  source: ExerciseSource;
  /** false only for `source: 'camera'`. */
  simulated: boolean;
}

// ---------- Patient-reported check-in ----------

export type ColdSensitivity = 'none' | 'mild' | 'moderate' | 'severe';

export type CheckInAnswer = number | boolean | string | null;

/**
 * Answers are stored against question ids from a schema (see domain/checkIn.ts)
 * rather than as fixed fields, so the questions can change, or a longer weekly
 * check-in can be added, without migrating old records.
 */
export interface CheckIn {
  id: string;
  patientId: string;
  /** Local calendar day, YYYY-MM-DD. One daily check-in per day; saving again replaces it. */
  date: string;
  schemaId: string;
  answers: Record<string, CheckInAnswer>;
  /** ISO timestamp of the last save. */
  updatedAt: string;
}

/** How strong a symptom has been over the week. Shared by the weekly questions. */
export type Severity = 'none' | 'mild' | 'moderate' | 'severe';

/**
 * The weekly questions. Kept apart from the daily check-in on purpose: the daily
 * rules assume one daily record per day, and a weekly answer must never be read
 * as a missing pain score.
 */
export interface WeeklyCheckIn {
  id: string;
  patientId: string;
  /** Local calendar day it was answered. */
  date: string;
  cold: Severity;
  tingling: Severity;
  /** 0 = everyday tasks not limited at all, 10 = could not do them. */
  function: number;
  updatedAt: string;
}

// ---------- People ----------

export type Hand = 'left' | 'right';
export type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'little';
export type FingerSegment = 'distal' | 'middle' | 'proximal';

/** Entered by a clinician during setup. Never shown to the patient. */
export interface ClinicalSetup {
  /** Which finger segment the repair is in, when no measured distance is available. */
  segment: FingerSegment | null;
  /** Measured distance from the nerve repair to the fingertip, in millimetres. Takes priority over `segment`. */
  repairToTipMm: number | null;
}

export interface Patient {
  id: string;
  /** Deliberately unlike a real record number, e.g. "Demo 03". */
  demoId: string;
  name: string;
  firstName: string;
  hand: Hand;
  finger: Finger;
  /** Short, generic injury context. Fictional. */
  injury: string;
  repairDate: string;
  enrolledDate: string;
  clinical: ClinicalSetup;
  fictional: true;
}

// ---------- Clinician triage (provisional rules, see domain/triage.ts) ----------

/** GREEN means "no current review trigger". It never means "recovering normally". */
export type TriageLevel = 'RED' | 'AMBER' | 'GREEN';

export type TriageRuleId =
  | 'NO_IMPROVEMENT'
  | 'MISSED_TESTS'
  | 'THRESHOLD_RISE'
  | 'NO_FELT_RECENT'
  | 'SKIN_ISSUE'
  | 'PAIN_INCREASE'
  | 'MISSED_EXERCISES'
  | 'MOVEMENT_DECLINE'
  | 'CLINICIAN_FLAG';

/**
 * Who a flag is for. Sensation results go to the surgical team, movement and
 * adherence to hand therapy, and wound, skin or pain problems to same-day review.
 */
export type CareRoute = 'surgeon' | 'therapist' | 'same-day' | 'team';

export interface TriageFlag {
  /** Stable for a given patient, rule and triggering evidence, so a review sticks to what was reviewed. */
  id: string;
  patientId: string;
  ruleId: TriageRuleId;
  level: Exclude<TriageLevel, 'GREEN'>;
  /** The exact provisional condition, written out with the parameter values in force. */
  condition: string;
  /** The recorded data that met the condition. A statement of fact, never an interpretation. */
  evidence: string;
  /** Calendar day the flag applies from. */
  raisedOn: string;
  status: 'pending' | 'reviewed';
  reviewedAt?: string;
  /** What the clinician wrote when recording the review. */
  note?: string;
  /** For CLINICIAN_FLAG only: what the clinician wrote when raising it. */
  flagNote?: string;
}

export interface ClinicianFlag {
  id: string;
  patientId: string;
  createdAt: string;
  note?: string;
}

export interface ClinicianNote {
  id: string;
  patientId: string;
  createdAt: string;
  text: string;
}

type RuleLevel = Exclude<TriageLevel, 'GREEN'>;

/**
 * Every threshold the rule engine uses. Kept as plain data in the demo state so
 * it can be edited in the portal and replaced when clinical guidance arrives.
 */
export interface TriageConfig {
  noImprovement: {
    enabled: boolean;
    level: RuleLevel;
    /** Length of the comparison window in days. Split into two equal halves. */
    windowDays: number;
    /** "Adequate testing": felt results needed in each half of the window. */
    minReadingsPerHalf: number;
    /** Drop in median level, earlier half to recent half, that counts as improvement. */
    minImprovementSteps: number;
    /** Not applied when the recent median is at or below this level (little scale left). */
    floorStep: number;
  };
  missedTests: { enabled: boolean; level: RuleLevel; consecutiveDays: number };
  thresholdRise: { enabled: boolean; level: RuleLevel; minTotalRise: number; withinDays: number };
  noFelt: { enabled: boolean; level: RuleLevel; withinDays: number };
  skinIssue: { enabled: boolean; level: RuleLevel; withinDays: number };
  painIncrease: {
    enabled: boolean;
    level: RuleLevel;
    points: number;
    baselineDays: number;
    minBaselineEntries: number;
    withinDays: number;
    /** A latest pain score at or above this raises the flag on its own, with no baseline needed. */
    severeAt: number;
  };
  /** Days in a row, counted back from yesterday, with no exercise session. */
  missedExercises: { enabled: boolean; level: RuleLevel; consecutiveDays: number };
  /** Camera-estimated range of the injured finger falling across recent sessions. */
  movementDecline: { enabled: boolean; level: RuleLevel; minDropDeg: number; sessionsPerSide: number };
}

/** Assumptions behind the clinician-only illustrative return window. All provisional. */
export interface EstimateConfig {
  /** Days after repair before regeneration is assumed to begin. */
  delayDays: { min: number; max: number };
  /** Assumed regeneration rate once under way. */
  rateMmPerDay: { slow: number; fast: number };
  /** Placeholder repair-to-fingertip distances used when only the segment is known. */
  segmentDistanceMm: Record<FingerSegment, { min: number; max: number }>;
}

// ---------- Demo state ----------

export type DemoSpeed = 1 | 6;

export interface Scenario {
  /**
   * timed: the simulated device reports whichever level is active when FELT arrives (firmware behaviour).
   * scripted: the simulated device reports a chosen level whenever FELT arrives.
   */
  result: { kind: 'timed' } | { kind: 'scripted'; level: RehabLevel };
  /** 1 = firmware timing (1 s + 10 × 3 s). 6 = fast preview for rehearsals. */
  speed: DemoSpeed;
  /** One-shot: drop the simulated link a few seconds into the next test. */
  dropLinkOnNextTest: boolean;
  /** While on, START answers ERR,DRIVER. */
  driverFault: boolean;
}

/** The demonstration wearable. Lives in localStorage so every tab sees one demo device. */
export interface SimulatedDevice {
  linkUp: boolean;
  mode: DeviceMode;
}

export interface DeviceLogEntry {
  at: string;
  direction: 'app' | 'device' | 'link';
  text: string;
  /** Which link the message crossed. Absent on older entries, which were all simulated. */
  via?: 'mock' | 'ble';
}

export interface DemoState {
  version: 2;
  /** Calendar day the seed was generated for. Seeded history is relative to this day. */
  anchorDate: string;
  activePatientId: string;
  patients: Patient[];
  tests: SensationTest[];
  checkIns: CheckIn[];
  weeklyCheckIns: WeeklyCheckIn[];
  exerciseSessions: ExerciseSession[];
  /**
   * Exercises a clinician has unlocked, per patient id. A patient with no entry
   * has the phase 1 exercise only. The app never unlocks anything by itself.
   */
  exercisePlans: Record<string, ExerciseId[]>;
  /**
   * Patients a clinician has moved to patient-initiated follow-up, with the day it
   * was decided. Always a clinician's decision: the app only shows who is eligible.
   */
  followUp: Record<string, { since: string }>;
  /** Snapshots of flags a clinician has recorded a review for. */
  flagLog: TriageFlag[];
  clinicianFlags: ClinicianFlag[];
  clinicianNotes: ClinicianNote[];
  triageConfig: TriageConfig;
  estimateConfig: EstimateConfig;
  scenario: Scenario;
  device: SimulatedDevice;
  deviceLog: DeviceLogEntry[];
  /** The patient's standing choice. Restored after a test, never after a disconnection. */
  assistPreferred: boolean;
  onboardingSeen: boolean;
}
