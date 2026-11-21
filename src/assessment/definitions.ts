/**
 * The movement assessments, as data.
 *
 * Each entry says what the start and target positions are, in terms of joint-angle
 * estimates, and how to explain the movement. None of the detection code lives
 * here, and none of it needs to change to add a movement.
 *
 * Read this before changing a number:
 *
 *  - The thresholds are DETECTION thresholds: how far a joint has to move for the
 *    software to recognise the position. They are not therapeutic targets, normal
 *    ranges or recovery thresholds, and nothing here claims to know what those are
 *    for a given patient. A clinician can change every one of them per patient.
 *  - Target thresholds are a CHANGE FROM THE START POSITION, not an absolute angle.
 *    A first recording of a real hand showed a flat finger reading anywhere from
 *    about -30 to +30 degrees at a joint depending on the view. Measuring the
 *    movement from where that hand started takes that offset out.
 *  - The positions are the standard tendon-gliding positions used in hand therapy
 *    (Wehbé and Hunter, 1985: straight hand, hook fist, tabletop, straight fist,
 *    full fist) and thumb opposition. Whether any of them is appropriate after a
 *    particular repair, and when, is the treating team's decision. They are offered
 *    as demonstration assessments, switched on per patient by a clinician.
 *  - The recommended views are ones a person can actually hold. Turning the thumb
 *    side of a raised hand to a camera in front of you is awkward; the same first
 *    recording made that plain. In front of a camera the side view asked for is the
 *    little-finger edge, like a karate chop.
 *  - The defaults were chosen so that a comfortable, unforced movement is
 *    recognised. They have not been tuned on patients.
 */
import type { Finger } from '../domain/types';
import type { Grade, HandView, LongFinger } from '../tracking/geometry';
import type { AssessmentDefinition, AssessmentId, AssessmentProtocol, CameraSetup, ParamSpec, ProtocolOverride } from './types';

const REPS: ParamSpec = {
  key: 'reps',
  label: 'Valid repetitions',
  help: 'The session finishes by itself once this many valid repetitions have been recorded.',
  unit: 'reps',
  default: 3,
  min: 1,
  max: 10,
  step: 1,
};

const HOLD: ParamSpec = {
  key: 'holdSeconds',
  label: 'Hold',
  help: 'How long the target position must be held, with usable tracking, for a repetition to be recorded.',
  unit: 's',
  default: 2,
  min: 0.5,
  max: 10,
  step: 0.5,
};

const STEADY: ParamSpec = {
  key: 'steadyWithin',
  label: 'Steadiness of the hold',
  help: 'A hold whose estimate wanders by more than this (robust standard deviation) is recorded as rejected rather than valid.',
  unit: 'deg',
  default: 14,
  min: 4,
  max: 30,
  step: 1,
};

const OPEN_BELOW: ParamSpec = {
  key: 'openBelow',
  label: 'Start: fingers straight',
  help: 'Detection threshold. The start position is recognised when combined finger flexion (MCP + PIP + DIP) is at or below this.',
  unit: 'deg',
  default: 75,
  min: 20,
  max: 140,
  step: 5,
};

export const DEFINITIONS: Record<AssessmentId, AssessmentDefinition> = {
  'composite-fist': {
    id: 'composite-fist',
    version: 2,
    title: 'Composite fist',
    clinical: 'Combined flexion of the MCP, PIP and DIP joints, from an open hand to a full fist',
    maturity: 'core',
    summary: 'Open your hand, close it into a comfortable fist, hold, then open again.',
    records: 'Combined flexion of each finger (MCP + PIP + DIP) while the fist is held, each joint’s estimate, how straight the fingers return, and how long each hold lasted.',
    digits: 'fingers',
    joints: ['mcp', 'pip', 'dip'],
    views: { facing: 'palmar', overhead: 'palmar', acceptable: ['palmar', 'oblique', 'radial', 'ulnar'] },
    viewReason:
      'Palm towards the camera keeps all four fingers in view through the whole movement. From this direction the fingers curl towards the lens, so the angles rest on the tracking model’s depth estimate and are labelled as such.',
    steadiness: 'handheld-ok',
    params: [
      REPS,
      HOLD,
      OPEN_BELOW,
      {
        key: 'fistAbove',
        label: 'Target: fist',
        help: 'Detection threshold. The fist is recognised when combined finger flexion has increased by this much from the start position. Not a therapeutic target.',
        unit: 'deg',
        default: 120,
        min: 40,
        max: 240,
        step: 5,
      },
      STEADY,
    ],
    start: [{ metric: 'composite', cmp: 'at-most', param: 'openBelow' }],
    target: [{ metric: 'composite', cmp: 'at-least', param: 'fistAbove' }],
    primary: 'composite',
    cues: {
      start: 'Open your hand, fingers straight',
      move: 'Close your hand into a comfortable fist',
      hold: 'Hold it there',
      release: 'Now open your hand',
    },
    steps: [
      'Hold your hand up with the palm facing the camera and your fingers straight.',
      'Close your hand into a fist. Only go as far as is comfortable, and never force it.',
      'Hold until the ring fills, then open your hand again.',
    ],
    figure: { start: 'open', target: 'fist' },
  },

  'hook-fist': {
    id: 'hook-fist',
    version: 2,
    title: 'Hook fist',
    clinical: 'PIP and DIP flexion with the MCP joints kept comparatively extended',
    maturity: 'core',
    summary: 'Keep your knuckles straight and curl just the ends of your fingers into a hook.',
    records: 'Flexion at the PIP and DIP joints while the hook is held, how far the MCP joints stayed extended, and how long each hold lasted.',
    digits: 'fingers',
    joints: ['mcp', 'pip', 'dip'],
    views: { facing: 'palmar', overhead: 'palmar', acceptable: ['palmar', 'oblique', 'radial', 'ulnar'] },
    viewReason:
      'Palm towards the camera is comfortable to hold and keeps all four fingers in view. The fingertips curl towards the lens, so the angles are depth-inferred and labelled as such. A side view reads the bend directly, but only for the finger nearest the camera.',
    steadiness: 'handheld-ok',
    params: [
      REPS,
      HOLD,
      OPEN_BELOW,
      {
        key: 'hookAbove',
        label: 'Target: end joints bent',
        help: 'Detection threshold. The hook is recognised when PIP + DIP flexion has increased by this much from the start position.',
        unit: 'deg',
        default: 85,
        min: 30,
        max: 180,
        step: 5,
      },
      {
        key: 'knucklesBelow',
        label: 'Target: knuckles straight',
        help: 'Detection threshold. MCP flexion must not have increased by more than this from the start position, for the position to count as a hook rather than a fist.',
        unit: 'deg',
        default: 45,
        min: 10,
        max: 80,
        step: 5,
      },
      STEADY,
    ],
    start: [{ metric: 'composite', cmp: 'at-most', param: 'openBelow' }],
    target: [
      { metric: 'ip-sum', cmp: 'at-least', param: 'hookAbove' },
      { metric: 'mcp', cmp: 'at-most', param: 'knucklesBelow', hint: 'Keep your knuckles straight and bend only the end joints' },
    ],
    primary: 'ip-sum',
    cues: {
      start: 'Open your hand, fingers straight',
      move: 'Curl the ends of your fingers, knuckles straight',
      hold: 'Hold the hook',
      release: 'Now straighten your fingers',
    },
    steps: [
      'Hold your hand up with the palm facing the camera and your fingers straight.',
      'Keeping the big knuckles straight, curl the middle and end joints so your fingertips come down towards the top of your palm.',
      'Hold until the ring fills, then straighten your fingers.',
    ],
    figure: { start: 'open', target: 'hook' },
  },

  tabletop: {
    id: 'tabletop',
    version: 2,
    title: 'Tabletop',
    clinical: 'MCP flexion with the PIP and DIP joints kept comparatively extended (intrinsic-plus position)',
    maturity: 'core',
    summary: 'Bend at the big knuckles only, keeping your fingers straight, like a flat table top.',
    records: 'Flexion at the MCP joints while the position is held, how straight the PIP and DIP joints stayed, and how long each hold lasted.',
    digits: 'fingers',
    joints: ['mcp', 'pip', 'dip'],
    views: { facing: 'ulnar', overhead: 'radial', acceptable: ['radial', 'ulnar', 'oblique'] },
    viewReason:
      'Side-on, the bend at the big knuckle lies across the picture. Palm-on, the fingers would point straight at the lens in this position and the angle could not be seen. Side-on, only the finger nearest the camera can be read.',
    steadiness: 'steady-preferred',
    params: [
      REPS,
      HOLD,
      OPEN_BELOW,
      {
        key: 'knucklesAbove',
        label: 'Target: knuckles bent',
        help: 'Detection threshold. The position is recognised when MCP flexion has increased by this much from the start position.',
        unit: 'deg',
        default: 45,
        min: 15,
        max: 95,
        step: 5,
      },
      {
        key: 'fingersBelow',
        label: 'Target: fingers straight',
        help: 'Detection threshold. PIP + DIP flexion must not have increased by more than this from the start position, for the position to count as a tabletop.',
        unit: 'deg',
        default: 45,
        min: 15,
        max: 90,
        step: 5,
      },
      STEADY,
    ],
    start: [{ metric: 'composite', cmp: 'at-most', param: 'openBelow' }],
    target: [
      { metric: 'mcp', cmp: 'at-least', param: 'knucklesAbove' },
      { metric: 'ip-sum', cmp: 'at-most', param: 'fingersBelow', hint: 'Keep your fingers straight and bend only at the big knuckles' },
    ],
    primary: 'mcp',
    cues: {
      start: 'Hold your hand side-on, fingers straight',
      move: 'Bend at the big knuckles, fingers straight',
      hold: 'Hold the position',
      release: 'Now straighten your hand',
    },
    steps: [
      'Turn your hand side-on, like a karate chop: little-finger edge towards the camera, thumb towards you, fingers straight.',
      'Bend at the big knuckles only, keeping your fingers straight, until they point sideways like a table top.',
      'Hold until the ring fills, then straighten your hand.',
    ],
    figure: { start: 'open', target: 'tabletop' },
  },

  'thumb-opposition': {
    id: 'thumb-opposition',
    version: 2,
    title: 'Thumb opposition',
    clinical: 'Thumb tip brought to the tip of a chosen finger',
    maturity: 'exploratory',
    summary: 'Bring the tip of your thumb to the tip of one finger, hold, then move them apart.',
    records: 'The distance between the thumb tip and the fingertip, relative to the size of the palm, while they are held together.',
    digits: 'one-finger',
    joints: ['mcp', 'pip', 'dip'],
    views: { facing: 'palmar', overhead: 'palmar', acceptable: ['palmar', 'oblique'] },
    viewReason:
      'Palm-on, the thumb and the fingertip come together across the picture, so the gap between them is visible. The gap is given relative to the palm; the camera cannot give it in millimetres.',
    steadiness: 'handheld-ok',
    params: [
      REPS,
      { ...HOLD, default: 1.5 },
      {
        key: 'apartAbove',
        label: 'Start: apart',
        help: 'Detection threshold. The start position is recognised when the thumb tip and fingertip are at least this far apart, in palm lengths.',
        unit: 'palm',
        default: 0.6,
        min: 0.35,
        max: 1.2,
        step: 0.05,
      },
      {
        key: 'touchBelow',
        label: 'Target: together',
        help: 'Detection threshold. Tips count as together at or below this distance, in palm lengths. Landmarks sit inside the pads, so touching tips read about 0.15 to 0.25.',
        unit: 'palm',
        default: 0.3,
        min: 0.15,
        max: 0.5,
        step: 0.05,
      },
    ],
    start: [{ metric: 'opposition', cmp: 'at-least', param: 'apartAbove' }],
    target: [{ metric: 'opposition', cmp: 'at-most', param: 'touchBelow' }],
    primary: 'opposition',
    cues: {
      start: 'Open your hand, thumb out to the side',
      move: 'Bring your thumb tip to your fingertip',
      hold: 'Hold them together',
      release: 'Now move them apart',
    },
    steps: [
      'Hold your hand up with the palm facing the camera, fingers straight and thumb out to the side.',
      'Bring the tip of your thumb and the tip of the chosen finger together.',
      'Hold until the ring fills, then move them apart.',
    ],
    figure: { start: 'opposition-open', target: 'opposition-touch' },
  },

  'digit-flexion': {
    id: 'digit-flexion',
    version: 2,
    title: 'Single finger flexion',
    clinical: 'Flexion and extension of one chosen finger at the MCP, PIP and DIP joints',
    maturity: 'exploratory',
    summary: 'Bend one finger as far as is comfortable, hold briefly, then straighten it.',
    records: 'For the chosen finger: each joint’s estimate when bent and when straight, and the arc between them.',
    digits: 'one-finger',
    joints: ['mcp', 'pip', 'dip'],
    views: { facing: 'palmar', overhead: 'palmar', acceptable: ['radial', 'ulnar', 'oblique', 'palmar'] },
    viewReason:
      'Palm towards the camera keeps the chosen finger clear of the others. Its angles are depth-inferred from this direction. The little finger can instead be read directly from its own side.',
    steadiness: 'handheld-ok',
    params: [
      REPS,
      { ...HOLD, default: 1 },
      { ...OPEN_BELOW, label: 'Start: finger straight' },
      {
        key: 'bentAbove',
        label: 'Target: finger bent',
        help: 'Detection threshold. The bend is recognised when the finger’s combined flexion has increased by this much from the start position.',
        unit: 'deg',
        default: 100,
        min: 30,
        max: 240,
        step: 5,
      },
      STEADY,
    ],
    start: [{ metric: 'composite', cmp: 'at-most', param: 'openBelow' }],
    target: [{ metric: 'composite', cmp: 'at-least', param: 'bentAbove' }],
    primary: 'composite',
    cues: {
      start: 'Straighten the finger',
      move: 'Bend the finger as far as is comfortable',
      hold: 'Hold it there',
      release: 'Now straighten it',
    },
    steps: [
      'Hold your hand up with the palm facing the camera and your fingers straight.',
      'Bend the chosen finger as far as is comfortable. The other fingers can move with it.',
      'Hold briefly, then straighten it.',
    ],
    figure: { start: 'open', target: 'fist' },
  },
};

export const ASSESSMENT_ORDER: readonly AssessmentId[] = ['composite-fist', 'hook-fist', 'tabletop', 'thumb-opposition', 'digit-flexion'];

export function isAssessmentId(value: string | undefined): value is AssessmentId {
  return value !== undefined && (ASSESSMENT_ORDER as readonly string[]).includes(value);
}

/** What is switched on before a clinician changes anything: the three core assessments. */
export const DEFAULT_PROTOCOL: AssessmentProtocol = {
  enabled: ASSESSMENT_ORDER.filter((id) => DEFINITIONS[id].maturity === 'core'),
  overrides: {},
};

export function protocolFor(protocols: Record<string, AssessmentProtocol> | undefined, patientId: string): AssessmentProtocol {
  const stored = protocols?.[patientId];
  if (!stored) return DEFAULT_PROTOCOL;
  return { enabled: ASSESSMENT_ORDER.filter((id) => stored.enabled.includes(id)), overrides: stored.overrides ?? {} };
}

/** The definition's defaults with a clinician's changes applied, each kept inside its allowed range. */
export function resolveParams(definition: AssessmentDefinition, override?: ProtocolOverride): Record<string, number> {
  const params: Record<string, number> = {};
  for (const spec of definition.params) {
    const chosen = override?.params?.[spec.key];
    const value = typeof chosen === 'number' && Number.isFinite(chosen) ? chosen : spec.default;
    params[spec.key] = Math.min(spec.max, Math.max(spec.min, value));
  }
  return params;
}

export const LONG: readonly LongFinger[] = ['index', 'middle', 'ring', 'little'];

export interface ResolvedAssessment {
  definition: AssessmentDefinition;
  params: Record<string, number>;
  minGrade: Exclude<Grade, 'unavailable'>;
  /** Digits whose estimates decide whether a position has been reached. */
  digits: Finger[];
  /** The digit the read-out is centred on. */
  focus: LongFinger;
}

/** Everything a session needs, for one patient's injured finger and whatever their clinician has set. */
export function resolveAssessment(id: AssessmentId, injured: Finger, override?: ProtocolOverride): ResolvedAssessment {
  const definition = DEFINITIONS[id];
  const chosen = override?.finger ?? injured;
  // The thumb is not one of the four fingers these positions are made of; the index finger stands in as the read-out's focus.
  const focus: LongFinger = chosen === 'thumb' ? 'index' : chosen;
  return {
    definition,
    params: resolveParams(definition, override),
    minGrade: override?.minGrade ?? 'inferred',
    digits: definition.digits === 'fingers' ? [...LONG] : [focus],
    focus,
  };
}

/**
 * How the hand and the camera are arranged.
 * facing:   the hand is held up in front of a camera (a laptop, a propped phone, a helper).
 * overhead: the hand rests on a table and a phone in the other hand looks down at it.
 */
export type Arrangement = 'facing' | 'overhead';

export const arrangementOf = (setup: CameraSetup): Arrangement => (setup === 'phone-held' ? 'overhead' : 'facing');

/** The view to ask for: one the assessment can be read from and the person can hold comfortably. */
export function recommendedView(definition: AssessmentDefinition, focus: LongFinger, setup: CameraSetup = 'laptop'): HandView {
  const arrangement = arrangementOf(setup);
  // The little finger can be read directly from its own side, which is the comfortable side to show a camera in front.
  if (definition.id === 'digit-flexion' && focus === 'little' && arrangement === 'facing') return 'ulnar';
  if (definition.id === 'digit-flexion' && focus === 'index' && arrangement === 'overhead') return 'radial';
  return definition.views[arrangement];
}

/** The digit a side view actually shows: the one nearest the camera. Null for views that show them all. */
export function nearestDigit(view: HandView): LongFinger | null {
  return view === 'radial' ? 'index' : view === 'ulnar' ? 'little' : null;
}

const TURN: Record<HandView, string> = {
  palmar: 'Turn your palm towards the camera',
  dorsal: 'Turn the back of your hand towards the camera',
  radial: 'Turn your hand side-on, thumb side towards the camera',
  ulnar: 'Turn your hand side-on, little-finger edge towards the camera',
  oblique: 'Turn your hand halfway between palm-on and side-on',
  'end-on': 'Point your fingers up, not at the camera',
};

/** How to turn the hand, said when the view is not one the assessment accepts. */
export function viewAdvice(definition: AssessmentDefinition, focus: LongFinger, setup: CameraSetup = 'laptop'): string {
  return TURN[recommendedView(definition, focus, setup)];
}

export const VIEW_WORDS: Record<HandView, string> = {
  palmar: 'Palm towards the camera',
  dorsal: 'Back of the hand towards the camera',
  radial: 'Side-on, thumb side towards the camera',
  ulnar: 'Side-on, little-finger edge towards the camera',
  oblique: 'Angled, between palm-on and side-on',
  'end-on': 'Fingers pointing at the camera',
};

export const METRIC_WORDS: Record<AssessmentDefinition['primary'], { label: string; unit: 'deg' | 'palm' }> = {
  mcp: { label: 'MCP flexion', unit: 'deg' },
  pip: { label: 'PIP flexion', unit: 'deg' },
  dip: { label: 'DIP flexion', unit: 'deg' },
  'ip-sum': { label: 'PIP + DIP flexion', unit: 'deg' },
  composite: { label: 'Composite flexion', unit: 'deg' },
  opposition: { label: 'Thumb-to-fingertip gap', unit: 'palm' },
};
