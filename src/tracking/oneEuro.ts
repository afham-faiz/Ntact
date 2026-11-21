/**
 * One Euro filter (Casiez, Roussel and Vogel, CHI 2012).
 *
 * A low-pass filter whose cut-off rises with speed: heavy smoothing while a point
 * is still (where jitter is most visible and matters most to a held measurement),
 * light smoothing while it moves (where lag matters more than jitter).
 *
 * Chosen over a Kalman filter because it needs two intuitive parameters instead
 * of a motion model and noise covariances that would have to be invented for a
 * hand, and over a fixed moving average because a fixed window either lags a fast
 * fist or leaves a held posture jittery. See docs/TRACKING_ENGINE.md for the
 * measurements behind the default parameters.
 */

export interface OneEuroParams {
  /** Cut-off at rest, in Hz. Lower is smoother and laggier. */
  minCutoff: number;
  /**
   * How quickly the cut-off rises with speed: Hz per (reference length per second).
   * The reference length is passed to `filter` as `unitScale`, so one setting works
   * for a hand near the camera and for one far away.
   */
  beta: number;
  /** Cut-off for the speed estimate itself, in Hz. */
  derivativeCutoff: number;
}

const smoothing = (cutoffHz: number, dtSeconds: number): number => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSeconds);
};

/** One scalar signal. */
export class OneEuroFilter {
  private value: number | null = null;
  private derivative = 0;

  constructor(private readonly params: OneEuroParams) {}

  reset(): void {
    this.value = null;
    this.derivative = 0;
  }

  /**
   * `dtSeconds` is the time since the previous sample. The first sample passes through unchanged.
   * `unitScale` is the length that speed is judged against (the palm's size, in the signal's units).
   */
  filter(sample: number, dtSeconds: number, unitScale = 1): number {
    if (this.value === null || !(dtSeconds > 0)) {
      this.value = sample;
      this.derivative = 0;
      return sample;
    }
    const rawDerivative = (sample - this.value) / dtSeconds;
    this.derivative += smoothing(this.params.derivativeCutoff, dtSeconds) * (rawDerivative - this.derivative);
    const cutoff = this.params.minCutoff + (this.params.beta * Math.abs(this.derivative)) / Math.max(unitScale, 1e-9);
    this.value += smoothing(cutoff, dtSeconds) * (sample - this.value);
    return this.value;
  }
}

/** A bank of filters for a fixed-length array of numbers (a flattened landmark set). */
export class OneEuroBank {
  private readonly filters: OneEuroFilter[];

  constructor(size: number, params: OneEuroParams) {
    this.filters = Array.from({ length: size }, () => new OneEuroFilter(params));
  }

  reset(): void {
    for (const filter of this.filters) filter.reset();
  }

  filter(samples: readonly number[], dtSeconds: number, unitScale = 1): number[] {
    return samples.map((sample, index) => this.filters[index].filter(sample, dtSeconds, unitScale));
  }
}
