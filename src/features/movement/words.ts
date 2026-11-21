/**
 * The words the movement screens use, in one place, so the patient app, the
 * clinician record and the presentation say the same thing the same way.
 */
import { recommendedView, type ResolvedAssessment } from '../../assessment/definitions';
import type { AssessmentDefinition, CameraSetup, RejectReason } from '../../assessment/types';
import type { Facing } from '../../camera/cameraStream';
import type { Finger } from '../../domain/types';
import type { Grade, HandView, JointId, LongFinger } from '../../tracking/geometry';
import type { QualityAdvisory, QualityReason } from '../../tracking/tracker';

export const JOINT_NAME: Record<JointId, { short: string; plain: string; long: string }> = {
  mcp: { short: 'MCP', plain: 'Big knuckle', long: 'Metacarpophalangeal joint' },
  pip: { short: 'PIP', plain: 'Middle joint', long: 'Proximal interphalangeal joint' },
  dip: { short: 'DIP', plain: 'End joint', long: 'Distal interphalangeal joint' },
  ip: { short: 'IP', plain: 'Thumb end joint', long: 'Interphalangeal joint of the thumb' },
};

export const FINGER_NAME: Record<Finger, string> = {
  thumb: 'Thumb',
  index: 'Index',
  middle: 'Middle',
  ring: 'Ring',
  little: 'Little',
};

export const fingerWords = (finger: Finger): string => (finger === 'thumb' ? 'thumb' : `${finger} finger`);

export const GRADE_WORD: Record<Grade, { tag: string; meaning: string }> = {
  direct: { tag: 'In view', meaning: 'The joint bent across the picture, so its angle was visible in the image itself.' },
  inferred: { tag: 'Depth-inferred', meaning: 'The joint bent towards or away from the camera. The angle rests on the tracking model’s estimate of depth.' },
  unavailable: { tag: 'Not seen', meaning: 'The joint was hidden behind another part of the hand. No value is given.' },
};

export const VIEW_NAME: Record<HandView, string> = {
  palmar: 'Palm view',
  dorsal: 'Back-of-hand view',
  radial: 'Side view, thumb side',
  ulnar: 'Side view, little-finger side',
  oblique: 'Angled view',
  'end-on': 'End-on view',
};

export const REJECT_WORD: Record<RejectReason, string> = {
  'hold-too-short': 'Not held for long enough',
  'tracking-lost': 'Tracking was lost during the hold',
  unsteady: 'The hold was not steady',
  'target-not-reached': 'Did not reach the set position',
};

export const REASON_WORD: Record<QualityReason | 'view' | 'hidden', string> = {
  'no-hand': 'No hand in view',
  'tracking-held': 'Tracking briefly lost',
  clipped: 'Hand partly out of the picture',
  'too-far': 'Hand too far from the camera',
  'too-close': 'Hand too close to the camera',
  'device-moving': 'The phone was moving',
  'moving-fast': 'The hand was moving across the picture',
  unstable: 'Unsteady landmarks',
  settling: 'Tracking settling',
  view: 'View not suitable for this assessment',
  hidden: 'Assessed joints hidden',
};

export const ADVISORY_WORD: Record<QualityAdvisory, string> = {
  'low-light': 'The picture is dark. Brighter, even light helps tracking.',
  'low-frame-rate': 'This device is tracking slowly. Hold each position a little longer.',
  'second-hand': 'A second hand is in view. Only one is being followed.',
};

export const SETUP_NAME: Record<CameraSetup, { title: string; line: string }> = {
  laptop: { title: 'Laptop or webcam', line: 'Sitting in front of a computer' },
  'phone-propped': { title: 'Phone on a stand', line: 'Leaning against something steady' },
  'phone-held': { title: 'Phone in my other hand', line: 'On your own, one-handed' },
  'phone-assisted': { title: 'Someone is holding it', line: 'A helper points the camera' },
};

export const SETUP_ORDER: readonly CameraSetup[] = ['laptop', 'phone-propped', 'phone-held', 'phone-assisted'];

/** The camera to ask for first. The rear camera is sharper and is the natural one when the phone is pointed at the hand. */
export function defaultFacing(setup: CameraSetup): Facing {
  return setup === 'phone-held' || setup === 'phone-assisted' ? 'environment' : 'user';
}

export function defaultSetup(): CameraSetup {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'laptop';
  return window.matchMedia('(pointer: coarse)').matches ? 'phone-propped' : 'laptop';
}

const HAND_PLACE: Record<'palmar' | 'radial' | 'ulnar' | 'oblique', Record<CameraSetup, string>> = {
  palmar: {
    laptop: 'Hold your hand up in front of the camera, palm towards the lens, about half an arm’s length away.',
    'phone-propped': 'Hold your hand up in front of the phone, palm towards the camera, about half an arm’s length away.',
    'phone-held': 'Rest the back of your hand on a table, palm up. Hold the phone in your other hand, straight above it, about 30 cm away.',
    'phone-assisted': 'Hold your hand out, palm towards the phone. Your helper keeps the whole hand in the picture, about 30 cm away.',
  },
  radial: {
    laptop: 'Turn your hand side-on with your thumb nearest the camera and out of the way of your fingers.',
    'phone-propped': 'Turn your hand side-on with your thumb nearest the phone and out of the way of your fingers.',
    'phone-held': 'Rest your hand on its little-finger edge on a table, thumb on top. Hold the phone above it, looking down at the thumb side.',
    'phone-assisted': 'Hold your hand side-on. Your helper points the camera at the thumb side.',
  },
  ulnar: {
    laptop: 'Hold your hand up side-on, like a karate chop: little-finger edge towards the camera, thumb towards you.',
    'phone-propped': 'Hold your hand up side-on, like a karate chop: little-finger edge towards the phone, thumb towards you.',
    'phone-held': 'Hold your hand upright with the little-finger edge towards the phone, your elbow resting on a table.',
    'phone-assisted': 'Hold your hand up side-on, like a karate chop. Your helper points the camera at the little-finger edge.',
  },
  oblique: {
    laptop: 'Turn your hand about halfway between palm-on and side-on, so the finger being assessed is clear of the others.',
    'phone-propped': 'Turn your hand about halfway between palm-on and side-on, so the finger being assessed is clear of the others.',
    'phone-held': 'Rest your forearm on a table and turn your hand about halfway between palm-up and side-on. Hold the phone above it.',
    'phone-assisted': 'Turn your hand about halfway between palm-on and side-on. Your helper keeps the finger being assessed in clear view.',
  },
};

export interface SetupAdvice {
  view: HandView;
  place: string;
  /** Said when the assessment would rather have a steady camera than a hand-held one. */
  caution: string | null;
  reason: string;
}

/** How to set up for one assessment with one way of holding the camera. */
export function setupAdvice(definition: AssessmentDefinition, focus: LongFinger, setup: CameraSetup): SetupAdvice {
  const view = recommendedView(definition, focus, setup);
  const key = view === 'palmar' || view === 'radial' || view === 'ulnar' ? view : 'oblique';
  return {
    view,
    place: HAND_PLACE[key][setup],
    caution:
      setup === 'phone-held' && definition.steadiness === 'steady-preferred'
        ? 'This assessment reads the finger from the side, which is sensitive to the camera moving. It can be tried hand-held, and unsteady readings are rejected rather than recorded, but a propped phone or a helper will give steadier results.'
        : null,
    reason: definition.viewReason,
  };
}

export const viewAdviceFor = (setup: ResolvedAssessment, camera: CameraSetup): SetupAdvice => setupAdvice(setup.definition, setup.focus, camera);

export function formatAngle(value: number | null | undefined): string {
  return value === null || value === undefined ? '–' : `≈${Math.round(value)}°`;
}

export function formatPrimary(value: number | null | undefined, unit: 'deg' | 'palm'): string {
  if (value === null || value === undefined) return '–';
  return unit === 'deg' ? `≈${Math.round(value)}°` : `≈${value.toFixed(2)} palm lengths`;
}

export function formatSeconds(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? '–' : `${(ms / 1000).toFixed(1)} s`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** What the figures are and are not. Shown wherever a figure is. */
export const ESTIMATE_NOTE =
  'Angles are estimates from a single camera view. They have not been compared with goniometer measurements and are not a clinical measurement.';

export const PATIENT_MEANING = {
  does: 'It shows how far your finger joints appeared to bend today, as seen by the camera, so you and your therapist can see how that changes over time.',
  doesNot: 'It is not a measurement of your joints, it does not measure feeling in your finger, and it cannot tell you whether you are recovering as expected. Your care team does that.',
};
