/**
 * Illustrative movement-assessment history for the fictional patients.
 *
 * ILLUSTRATIVE, NOT MEASURED. Every session made here is `source: 'seed'` and
 * `synthetic: true`. None of it came from a camera or from a person; the figures
 * are written directly from a made-up progression so that the clinician screens
 * have something to show. They pass through the same summary code as a real
 * session, so what the screens do with them is real, but the numbers themselves
 * mean nothing clinically and are labelled as illustrative wherever they appear.
 */
import { DEFINITIONS, LONG, resolveAssessment } from '../assessment/definitions';
import { buildSession, TRACKING_DEFAULTS } from '../assessment/session';
import type { AssessmentId, AssessmentSession, RepJoint, RepRecord } from '../assessment/types';
import { addDays, atLocalTime, type DateKey } from '../domain/dates';
import type { Finger, Patient } from '../domain/types';
import type { Grade, HandView, JointId, LongFinger } from '../tracking/geometry';

/** How far the injured finger gets, as a share of an easy full movement, at the start and end of each person's history. */
const PROGRESS: Record<string, [from: number, to: number]> = {
  'p-maya': [0.58, 0.86],
  'p-tomas': [0.64, 0.67],
  'p-priya': [0.5, 0.66],
  'p-daniel': [0.55, 0.58],
  'p-aiko': [0.42, 0.5],
  'p-samuel': [0.68, 0.92],
  'p-elin': [0.36, 0.39],
  'p-leon': [0.52, 0.68],
  'p-noor': [0.72, 0.95],
};

/** The made-up "easy full movement" each assessment is scaled from. Degrees at MCP, PIP, DIP. */
const FULL: Record<Exclude<AssessmentId, 'thumb-opposition'>, Record<JointId, number>> = {
  'composite-fist': { mcp: 82, pip: 98, dip: 58, ip: 0 },
  'hook-fist': { mcp: 8, pip: 94, dip: 56, ip: 0 },
  tabletop: { mcp: 78, pip: 9, dip: 5, ip: 0 },
  'digit-flexion': { mcp: 70, pip: 92, dip: 50, ip: 0 },
};

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** A repeatable number in -1..1. */
const wobble = (key: string): number => ((hash(key) % 20_001) / 10_000) - 1;
const round = (value: number): number => Math.round(value * 10) / 10;

interface SeedOptions {
  /** 0 to 1: how far the injured finger gets. */
  level: number;
  view: HandView;
  /** Share of the session with usable tracking. */
  usable?: number;
  rejected?: number;
  reps?: number;
  hour?: number;
  minute?: number;
}

export function makeSeedAssessment(
  patient: Pick<Patient, 'id' | 'hand' | 'finger'>,
  day: DateKey,
  assessmentId: Exclude<AssessmentId, 'thumb-opposition'>,
  options: SeedOptions,
): AssessmentSession {
  const setup = resolveAssessment(assessmentId, patient.finger);
  const definition = DEFINITIONS[assessmentId];
  const full = FULL[assessmentId];
  const key = `${patient.id}|${day}|${assessmentId}`;
  const sideOn = options.view === 'radial' || options.view === 'ulnar';
  // Side-on, only the finger nearest the camera is seen. Palm-on, all four are.
  const nearest: LongFinger = options.view === 'ulnar' ? 'little' : 'index';
  const seen: LongFinger[] = sideOn ? [nearest] : [...LONG];
  const grade: Grade = sideOn ? 'direct' : 'inferred';
  const target = options.reps ?? 3;
  const reps: RepRecord[] = [];
  let clock = 2400;

  const jointsFor = (rep: number): RepRecord['joints'] => {
    const joints: RepRecord['joints'] = {};
    for (const finger of seen) {
      const injured = finger === patient.finger;
      // Uninjured fingers make the easy full movement; the injured one makes its share of it.
      const share = injured ? options.level : 0.97;
      const entry: Partial<Record<JointId, RepJoint>> = {};
      for (const joint of ['mcp', 'pip', 'dip'] as const) {
        const moving = full[joint] > 20;
        const held = full[joint] * (moving ? share : 1) + wobble(`${key}|${finger}|${joint}|${rep}`) * 3.2;
        const start = (injured ? 9 + (1 - options.level) * 14 : 4) + wobble(`${key}|${finger}|${joint}|${rep}|start`) * 2.4;
        entry[joint] = { held: round(held), peak: round(held + 1.5 + Math.abs(wobble(`${key}|${finger}|${joint}|${rep}|peak`)) * 3), start: round(joint === 'mcp' ? start * 0.5 : start), grade };
      }
      joints[finger] = entry;
    }
    return joints;
  };

  const primaryOf = (joints: RepRecord['joints']): number => {
    const fingers = Object.keys(joints) as Finger[];
    const one = (finger: Finger): number => {
      const entry = joints[finger] ?? {};
      const mcp = entry.mcp?.held ?? 0;
      const pip = entry.pip?.held ?? 0;
      const dip = entry.dip?.held ?? 0;
      return definition.primary === 'mcp' ? mcp : definition.primary === 'ip-sum' ? pip + dip : mcp + pip + dip;
    };
    return round(fingers.reduce((sum, finger) => sum + one(finger), 0) / Math.max(1, fingers.length));
  };

  const rejected = options.rejected ?? 0;
  for (let index = 0; index < target + rejected; index += 1) {
    const valid = index >= rejected;
    const joints = jointsFor(index);
    const holdMs = valid ? Math.round(setup.params.holdSeconds * 1000 + 250 + Math.abs(wobble(`${key}|hold|${index}`)) * 700) : 600 + Math.round(Math.abs(wobble(`${key}|short|${index}`)) * 500);
    reps.push({
      attempt: index + 1,
      valid,
      rejectReason: valid ? null : index % 2 === 0 ? 'hold-too-short' : 'tracking-lost',
      startedAt: clock,
      endedAt: clock + 900 + holdMs + 900,
      holdMs,
      timeToTargetMs: 780 + Math.round(Math.abs(wobble(`${key}|move|${index}`)) * 420),
      primary: primaryOf(joints),
      holdSd: round(1.6 + Math.abs(wobble(`${key}|sd|${index}`)) * 2.2),
      joints,
      digits: [...seen],
      returned: true,
      view: options.view,
      usable: valid ? 1 : 0.7,
    });
    clock += 900 + holdMs + 900 + 1300;
  }

  const usable = options.usable ?? 0.9 + wobble(`${key}|usable`) * 0.06;
  return buildSession({
    id: `seed-assess-${assessmentId}-${patient.id}-${day}`,
    patientId: patient.id,
    timestamp: atLocalTime(day, options.hour ?? 19, options.minute ?? 20 + Math.round(Math.abs(wobble(`${key}|minute`)) * 25)),
    hand: patient.hand,
    detectedHand: patient.hand,
    setup,
    reps,
    durationMs: clock,
    quality: {
      frames: Math.round((clock / 1000) * 30),
      tracked: Math.min(1, usable + 0.05),
      usable,
      jumps: rejected,
      reasons: usable < 0.7 ? { 'moving-fast': Math.round((clock / 1000) * 30 * (1 - usable) * 0.6), clipped: Math.round((clock / 1000) * 30 * (1 - usable) * 0.4) } : {},
    },
    view: options.view,
    capture: { setup: 'phone-propped', facing: 'user', width: 1280, height: 720, fps: 29.6, inferenceMs: null },
    tracking: { ...TRACKING_DEFAULTS, delegate: 'none', labelConvention: 'subject' },
    source: 'seed',
  });
}

/**
 * A composite-fist session every fourth day, and a hook fist and a tabletop every
 * eighth, from a few days after enrolment up to yesterday. One session per person
 * is deliberately poor (little usable tracking) and one is taken from a different
 * view, so the screens that flag those have something to flag.
 */
export function seedAssessmentSessions(patients: Patient[], anchor: DateKey): AssessmentSession[] {
  const sessions: AssessmentSession[] = [];
  for (const patient of patients) {
    const [from, to] = PROGRESS[patient.id] ?? [0.5, 0.6];
    const last = addDays(anchor, -1);
    const days: DateKey[] = [];
    for (let day = last; day >= addDays(patient.enrolledDate, 1); day = addDays(day, -4)) days.unshift(day);
    // Side-on, the finger nearest the camera is the index or the little finger: whichever is the patient's, else the index.
    const side: HandView = patient.finger === 'little' || patient.finger === 'ring' ? 'ulnar' : 'radial';
    days.forEach((day, index) => {
      const progress = days.length > 1 ? index / (days.length - 1) : 1;
      const level = from + (to - from) * progress + wobble(`${patient.id}|${day}|level`) * 0.025;
      const poor = days.length > 4 && index === Math.floor(days.length / 2);
      const otherView = days.length > 5 && index === days.length - 4;
      sessions.push(
        makeSeedAssessment(patient, day, 'composite-fist', {
          level,
          view: otherView ? 'oblique' : 'palmar',
          usable: poor ? 0.46 : undefined,
          rejected: poor ? 2 : index % 5 === 3 ? 1 : 0,
          reps: poor ? 1 : 3,
        }),
      );
      if (index % 2 === days.length % 2) {
        sessions.push(makeSeedAssessment(patient, day, 'hook-fist', { level, view: side, minute: 34 }));
        sessions.push(makeSeedAssessment(patient, day, 'tabletop', { level, view: side, minute: 41 }));
      }
    });
  }
  return sessions.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
