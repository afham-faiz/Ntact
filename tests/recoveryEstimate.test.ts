import { describe, expect, it } from 'vitest';
import { addDays, daysBetween } from '../src/domain/dates';
import { DEFAULT_ESTIMATE_CONFIG, ESTIMATE_LABEL, estimateReturnWindow } from '../src/domain/recoveryEstimate';
import type { ClinicalSetup, EstimateConfig } from '../src/domain/types';

const REPAIR_DATE = '2026-09-01';

const estimate = (clinical: ClinicalSetup, config: EstimateConfig = DEFAULT_ESTIMATE_CONFIG) =>
  estimateReturnWindow({ repairDate: REPAIR_DATE, clinical }, config);

describe('estimateReturnWindow', () => {
  it('is null when neither a segment nor a distance has been entered', () => {
    expect(estimate({ segment: null, repairToTipMm: null })).toBeNull();
    // Zero is not a measurement.
    expect(estimate({ segment: null, repairToTipMm: 0 })).toBeNull();
  });

  it('gives a measured distance priority over the segment placeholder', () => {
    const measured = estimate({ segment: 'proximal', repairToTipMm: 40 });
    const fromSegment = estimate({ segment: 'proximal', repairToTipMm: null });

    expect(measured?.basis).toBe('distance');
    expect(measured?.distanceMm).toEqual({ min: 40, max: 40 });
    expect(fromSegment?.basis).toBe('segment');
    expect(fromSegment?.distanceMm).toEqual(DEFAULT_ESTIMATE_CONFIG.segmentDistanceMm.proximal);
  });

  it('turns 40 mm into days 48 to 115 after the repair with the default assumptions', () => {
    const window = estimate({ segment: null, repairToTipMm: 40 });

    // Earliest: shortest delay plus the fast rate. Latest: longest delay plus the slow rate.
    expect(window?.earliestDay).toBe(Math.round(21 + 40 / 1.5));
    expect(window?.latestDay).toBe(Math.round(35 + 40 / 0.5));
    expect(window?.earliestDay).toBe(48);
    expect(window?.latestDay).toBe(115);
  });

  it('gives a window, never a single date: earliest is strictly before latest, both counted from the repair date', () => {
    const window = estimate({ segment: null, repairToTipMm: 40 });
    if (!window) throw new Error('expected a window');

    expect(window.earliest).toBe(addDays(REPAIR_DATE, window.earliestDay));
    expect(window.latest).toBe(addDays(REPAIR_DATE, window.latestDay));
    expect(window.earliest).toBe('2026-10-19');
    expect(window.latest).toBe('2026-12-25');
    expect(daysBetween(window.earliest, window.latest)).toBeGreaterThan(0);
  });

  it('uses the whole placeholder range when only the segment is known', () => {
    const window = estimate({ segment: 'distal', repairToTipMm: null });

    // Distal placeholder: 10 to 25 mm.
    expect(window?.earliestDay).toBe(Math.round(21 + 10 / 1.5));
    expect(window?.latestDay).toBe(Math.round(35 + 25 / 0.5));
  });

  it('states its assumptions and is labelled as illustrative', () => {
    const window = estimate({ segment: 'middle', repairToTipMm: null });

    expect(ESTIMATE_LABEL).toBe('Illustrative estimate — not clinically validated');
    expect(window?.assumptions.length).toBeGreaterThan(0);
    for (const assumption of window?.assumptions ?? []) expect(assumption.trim()).not.toBe('');
    // The assumptions say out loud that this is not a forecast of the test result.
    expect(window?.assumptions.join(' ')).toContain('not a forecast of the detection level');
  });

  it('moves the window when the provisional assumptions are changed', () => {
    const clinical: ClinicalSetup = { segment: null, repairToTipMm: 40 };
    const edited: EstimateConfig = {
      ...DEFAULT_ESTIMATE_CONFIG,
      delayDays: { min: 14, max: 28 },
      rateMmPerDay: { slow: 1, fast: 2 },
    };

    const byDefault = estimate(clinical);
    const withEdits = estimate(clinical, edited);

    expect(withEdits?.earliestDay).toBe(14 + 20);
    expect(withEdits?.latestDay).toBe(28 + 40);
    expect(withEdits?.earliest).not.toBe(byDefault?.earliest);
    expect(withEdits?.latest).not.toBe(byDefault?.latest);
  });
});
