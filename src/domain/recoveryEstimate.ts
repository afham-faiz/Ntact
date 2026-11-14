/**
 * Illustrative estimate of when sensation might begin returning at the fingertip.
 *
 * CLINICIAN-FACING ONLY, AND NOT CLINICALLY VALIDATED.
 *
 * The idea, as described by the team's medical lead: after a nerve repair there
 * is an initial delay of several weeks, after which regeneration may advance at
 * roughly 1 mm a day, with substantial variation. From a repair date and a
 * distance to the fingertip that gives a date WINDOW, never a single date.
 *
 * What this deliberately does not do:
 *  - it does not predict the vibration detection level. Regeneration distance and
 *    a detection threshold on this device are different measurements;
 *  - it is not shown to patients;
 *  - it does not feed the triage rules.
 *
 * Every number lives in EstimateConfig so it can be replaced when clinical
 * guidance is supplied.
 */
import { addDays, type DateKey } from './dates';
import type { EstimateConfig, FingerSegment, Patient } from './types';

export const ESTIMATE_LABEL = 'Illustrative estimate — not clinically validated';

export const DEFAULT_ESTIMATE_CONFIG: EstimateConfig = {
  // "An initial delay of several weeks." Provisional: three to five weeks.
  delayDays: { min: 21, max: 35 },
  // "Roughly 1 mm/day, but this varies substantially." Provisional band either side of 1.
  rateMmPerDay: { slow: 0.5, fast: 1.5 },
  // Placeholder distances for when only the segment is known. Not measured; replace with real guidance.
  segmentDistanceMm: {
    distal: { min: 10, max: 25 },
    middle: { min: 25, max: 50 },
    proximal: { min: 50, max: 90 },
  },
};

export const SEGMENT_LABEL: Record<FingerSegment, string> = {
  distal: 'Distal segment',
  middle: 'Middle segment',
  proximal: 'Proximal segment',
};

export interface ReturnWindow {
  earliest: DateKey;
  latest: DateKey;
  /** Days after repair. */
  earliestDay: number;
  latestDay: number;
  distanceMm: { min: number; max: number };
  /** Whether the distance was entered in millimetres or taken from the segment placeholder. */
  basis: 'distance' | 'segment';
  assumptions: string[];
}

function formatRange(min: number, max: number, unit: string): string {
  return min === max ? `${min} ${unit}` : `${min} to ${max} ${unit}`;
}

/**
 * Returns null when the clinician has not entered a segment or a distance.
 * The screens then ask for one instead of guessing.
 */
export function estimateReturnWindow(
  patient: Pick<Patient, 'repairDate' | 'clinical'>,
  config: EstimateConfig,
): ReturnWindow | null {
  const { segment, repairToTipMm } = patient.clinical;

  let distance: { min: number; max: number };
  let basis: ReturnWindow['basis'];
  if (repairToTipMm !== null && repairToTipMm > 0) {
    distance = { min: repairToTipMm, max: repairToTipMm };
    basis = 'distance';
  } else if (segment) {
    distance = config.segmentDistanceMm[segment];
    basis = 'segment';
  } else {
    return null;
  }

  const fast = Math.max(0.05, config.rateMmPerDay.fast);
  const slow = Math.max(0.05, config.rateMmPerDay.slow);
  const earliestDay = Math.round(config.delayDays.min + distance.min / fast);
  const latestDay = Math.round(config.delayDays.max + distance.max / slow);

  return {
    earliest: addDays(patient.repairDate, earliestDay),
    latest: addDays(patient.repairDate, latestDay),
    earliestDay,
    latestDay,
    distanceMm: distance,
    basis,
    assumptions: [
      `Regeneration is assumed to begin ${formatRange(config.delayDays.min, config.delayDays.max, 'days')} after the repair.`,
      `It is then assumed to advance at ${formatRange(config.rateMmPerDay.slow, config.rateMmPerDay.fast, 'mm')} a day.`,
      basis === 'distance'
        ? `Distance from repair to fingertip: ${distance.min} mm, as entered.`
        : `Distance from repair to fingertip: ${formatRange(distance.min, distance.max, 'mm')}, a placeholder range for a ${segment} segment repair.`,
      'The window is for when sensation might begin to return at the fingertip. It is not a forecast of the detection level.',
    ],
  };
}
