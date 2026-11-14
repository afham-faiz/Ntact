/**
 * Example exercise history for the fictional patients.
 *
 * Deterministic, like the rest of the seed. Every record is `source: 'seed'` and
 * `simulated: true`: none of it came from a camera. The patterns are deliberately
 * unremarkable (most days done, range level or easing upward) so that the seeded
 * worklist is driven by the same records as before. The demo controls can rewrite
 * a patient's history to show the two exercise rules firing.
 */
import { addDays, atLocalTime, type DateKey } from '../domain/dates';
import { EXERCISES } from '../domain/exercise';
import type { ExerciseId, ExerciseSession, ExerciseSource, Patient, Severity, WeeklyCheckIn } from '../domain/types';

/** Camera-estimated range, in degrees, at the start and end of each person's history. */
const RANGE: Record<string, [from: number, to: number]> = {
  'p-maya': [96, 142],
  'p-tomas': [104, 110],
  'p-priya': [84, 108],
  'p-daniel': [92, 98],
  'p-aiko': [70, 82],
  'p-samuel': [110, 150],
  'p-elin': [62, 66],
  'p-leon': [88, 112],
  'p-noor': [118, 156],
};

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** A repeatable number in 0..1 for a patient and a day. */
function chance(patientId: string, day: DateKey, salt: string): number {
  return (hash(`${patientId}|${day}|${salt}`) % 10_000) / 10_000;
}

export function makeExerciseSession(
  patient: Pick<Patient, 'id' | 'hand' | 'finger'>,
  day: DateKey,
  rangeDeg: number,
  source: ExerciseSource = 'seed',
  options: { reps?: number; hour?: number; minute?: number; exerciseId?: ExerciseId } = {},
): ExerciseSession {
  const exerciseId = options.exerciseId ?? 'open-close';
  const target = EXERCISES[exerciseId].targetReps;
  const reps = options.reps ?? target;
  const rest = 26 + Math.round(chance(patient.id, day, 'rest') * 10);
  const range = Math.max(0, Math.round(rangeDeg));
  return {
    id: `${source}-${exerciseId}-${patient.id}-${day}`,
    patientId: patient.id,
    timestamp: atLocalTime(day, options.hour ?? 19, options.minute ?? 5 + Math.round(chance(patient.id, day, 'minute') * 40)),
    exerciseId,
    reps,
    targetReps: target,
    completed: reps >= target,
    durationMs: reps * (3_100 + Math.round(chance(patient.id, day, 'pace') * 900)),
    site: { hand: patient.hand, finger: patient.finger },
    flexDeg: reps > 0 ? range + rest : null,
    extDeg: reps > 0 ? rest : null,
    rangeDeg: reps > 0 ? range : null,
    source,
    simulated: true,
  };
}

const SEVERITIES: Severity[] = ['none', 'mild', 'moderate', 'severe'];

/**
 * Weekly answers every seven days from a week after enrolment, the latest a few
 * days ago. Symptoms ease gently over the weeks; all of it is example data.
 */
export function seedWeeklyCheckIns(patients: Patient[], anchor: DateKey): WeeklyCheckIn[] {
  const entries: WeeklyCheckIn[] = [];
  for (const patient of patients) {
    const offset = 1 + (hash(patient.id) % 5);
    const days: DateKey[] = [];
    for (let day = addDays(anchor, -offset); day >= addDays(patient.enrolledDate, 6); day = addDays(day, -7)) days.unshift(day);
    days.forEach((day, index) => {
      const remaining = days.length - 1 - index;
      const level = (base: number, salt: string) =>
        SEVERITIES[Math.min(3, Math.max(0, base + Math.floor(remaining / 3) + (chance(patient.id, day, salt) > 0.75 ? 1 : 0)))];
      entries.push({
        id: `seed-weekly-${patient.id}-${day}`,
        patientId: patient.id,
        date: day,
        cold: level(1, 'cold'),
        tingling: level(0, 'tingling'),
        function: Math.min(10, 2 + remaining + Math.round(chance(patient.id, day, 'function') * 2)),
        updatedAt: atLocalTime(day, 20, 10),
      });
    });
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

/** Sessions from enrolment up to yesterday: most days, and always the last two. */
export function seedExerciseSessions(patients: Patient[], anchor: DateKey): ExerciseSession[] {
  const sessions: ExerciseSession[] = [];
  for (const patient of patients) {
    const [from, to] = RANGE[patient.id] ?? [90, 100];
    const yesterday = addDays(anchor, -1);
    const days: DateKey[] = [];
    for (let day = patient.enrolledDate; day <= yesterday; day = addDays(day, 1)) days.push(day);
    days.forEach((day, index) => {
      const recent = index >= days.length - 2;
      if (!recent && chance(patient.id, day, 'done') > 0.82) return;
      const progress = days.length > 1 ? index / (days.length - 1) : 1;
      const wobble = (chance(patient.id, day, 'wobble') - 0.5) * 10;
      const range = from + (to - from) * progress + wobble;
      // Finger slides first, then open and close a few minutes later. A slide bends the finger less than a fist.
      sessions.push(makeExerciseSession(patient, day, range * 0.58, 'seed', { exerciseId: 'finger-slides', hour: 18, minute: 50 }));
      sessions.push(makeExerciseSession(patient, day, range));
    });
  }
  return sessions.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
