/**
 * What one assessment session recorded, laid out the same way wherever it is
 * shown: after a session in the patient app, in the patient's history, in the
 * clinician record and on the presentation stage.
 *
 * Two things are kept visibly apart on purpose: whether the repetitions were
 * completed (completion), and the joint-angle estimates (what was observed).
 * Neither is turned into a score.
 */
import { DEFINITIONS, METRIC_WORDS } from '../../assessment/definitions';
import { comparability, qualityConcerns } from '../../assessment/session';
import type { AssessmentSession, JointSummary } from '../../assessment/types';
import { cx } from '../../components/ui';
import { formatDay, formatTime, dateKeyOf } from '../../domain/dates';
import type { Finger } from '../../domain/types';
import { DIGIT_JOINTS, type Grade, type JointId } from '../../tracking/geometry';
import {
  ESTIMATE_NOTE,
  FINGER_NAME,
  GRADE_WORD,
  JOINT_NAME,
  REASON_WORD,
  REJECT_WORD,
  SETUP_NAME,
  VIEW_NAME,
  formatAngle,
  formatDuration,
  formatPrimary,
  formatSeconds,
} from './words';

type Tone = 'dark' | 'light';

const SOURCE_WORD: Record<AssessmentSession['source'], { tag: string; note: string }> = {
  camera: { tag: 'Camera', note: 'Tracked from this device’s camera.' },
  'synthetic-replay': { tag: 'Synthetic replay', note: 'A drawn hand from the kinematic model, replayed through the same engine. Not a person, and not a measurement.' },
  seed: { tag: 'Illustrative', note: 'Illustrative example data written by the demonstration. Not a person, and not a measurement.' },
};

export function SourceTag({ session, tone = 'light' }: { session: AssessmentSession; tone?: Tone }) {
  const real = session.source === 'camera';
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-bold leading-5',
        real
          ? tone === 'dark'
            ? 'bg-mint text-ink'
            : 'bg-ink text-white'
          : tone === 'dark'
            ? 'border border-dashed border-mist/70 text-mist'
            : 'border border-dashed border-ink/40 text-ink-soft',
      )}
    >
      {SOURCE_WORD[session.source].tag}
    </span>
  );
}

export function GradeTag({ grade, tone = 'light' }: { grade: Grade; tone?: Tone }) {
  const dark = tone === 'dark';
  return (
    <span
      title={GRADE_WORD[grade].meaning}
      className={cx(
        'inline-flex whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-bold leading-4',
        grade === 'direct'
          ? dark
            ? 'border-mint/70 text-mint'
            : 'border-ink text-ink'
          : grade === 'inferred'
            ? dark
              ? 'border-dashed border-mint/50 text-mint/90'
              : 'border-dashed border-ink/40 text-ink-soft'
            : dark
              ? 'border-white/15 text-mist/70'
              : 'border-line text-ink-faint',
      )}
    >
      {GRADE_WORD[grade].tag}
    </span>
  );
}

function digitsIn(session: AssessmentSession): Finger[] {
  const order: Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'];
  return order.filter((finger) => session.summary.joints[finger] !== undefined);
}

function JointTable({ session, digit, tone, plain }: { session: AssessmentSession; digit: Finger; tone: Tone; plain: boolean }) {
  const dark = tone === 'dark';
  const soft = dark ? 'text-mist' : 'text-ink-soft';
  const strong = dark ? 'text-white' : 'text-ink';
  const rule = dark ? 'border-white/10' : 'border-line';
  const joints = DIGIT_JOINTS[digit].filter((joint) => session.summary.joints[digit]?.[joint]);
  if (joints.length === 0) return null;
  return (
    <table className="nums w-full text-[13.5px] leading-5">
      <thead>
        <tr className={cx('text-left text-[12px]', soft)}>
          <th className="py-1.5 pr-2 font-semibold">{FINGER_NAME[digit]}{digit === 'thumb' ? '' : ' finger'}</th>
          <th className="py-1.5 pr-2 text-right font-semibold">{plain ? 'Bent' : 'Held'}</th>
          <th className="py-1.5 pr-2 text-right font-semibold">{plain ? 'Straight' : 'Start'}</th>
          <th className="py-1.5 pr-2 text-right font-semibold">Arc</th>
          <th className="py-1.5 text-right font-semibold">Seen as</th>
        </tr>
      </thead>
      <tbody>
        {joints.map((joint: JointId) => {
          const row = session.summary.joints[digit]?.[joint] as JointSummary;
          return (
            <tr key={joint} className={cx('border-t', rule)}>
              <th className={cx('py-2 pr-2 text-left font-semibold', strong)}>
                {plain ? JOINT_NAME[joint].plain : JOINT_NAME[joint].short}
                {plain ? <span className={cx('ml-1 font-normal', soft)}>({JOINT_NAME[joint].short})</span> : null}
              </th>
              <td className={cx('py-2 pr-2 text-right font-bold', strong)}>{formatAngle(row.flex)}</td>
              <td className={cx('py-2 pr-2 text-right', soft)}>{formatAngle(row.ext)}</td>
              <td className={cx('py-2 pr-2 text-right', soft)}>{formatAngle(row.arc)}</td>
              <td className="py-2 text-right">
                <GradeTag grade={row.grade} tone={tone} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function SessionReport({
  session,
  previous = null,
  tone = 'light',
  audience,
  className,
}: {
  session: AssessmentSession;
  /** The most recent earlier session of the same assessment for this person, if any. */
  previous?: AssessmentSession | null;
  tone?: Tone;
  audience: 'patient' | 'clinical';
  className?: string;
}) {
  const dark = tone === 'dark';
  const plain = audience === 'patient';
  const definition = DEFINITIONS[session.assessmentId];
  const summary = session.summary;
  const metric = METRIC_WORDS[summary.primary.metric];
  const soft = dark ? 'text-mist' : 'text-ink-soft';
  const strong = dark ? 'text-white' : 'text-ink';
  const card = dark ? 'glass-dark rounded-[18px]' : 'glass rounded-[22px]';
  const rule = dark ? 'border-white/10' : 'border-line';
  const label = cx('text-[13px] font-bold leading-5', dark ? 'text-mint' : 'text-teal-600');
  const notReached = session.reps.filter((rep) => rep.rejectReason === 'target-not-reached');
  const otherRejected = summary.rejectedReps - notReached.length;
  const furthest = notReached.reduce<number | null>((best, rep) => (rep.primary !== null && (best === null || rep.primary > best) ? rep.primary : best), null);
  const digits = digitsIn(session);
  const shown = plain ? digits.filter((digit) => digit === session.focus || digits.length === 1 || !digits.includes(session.focus)).slice(0, 1) : digits;
  const concerns = qualityConcerns(session);
  const compare = previous ? comparability(session, previous) : null;
  const reasons = (Object.entries(session.quality.reasons) as [keyof typeof REASON_WORD, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <div className={cx('space-y-3', className)}>
      {/* Completion: were the repetitions done. Nothing here describes the hand. */}
      <div className={cx(card, 'px-4 py-3.5')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={label}>Completion</p>
            <p className={cx('display nums mt-0.5 text-[26px] leading-8', strong)}>
              {summary.validReps} of {summary.targetReps}
              <span className={cx('ml-2 text-[14px] font-semibold tracking-normal', soft)}>valid repetitions</span>
            </p>
          </div>
          <SourceTag session={session} tone={tone} />
        </div>
        <p className={cx('mt-1 text-[13px] leading-5', soft)}>
          {otherRejected > 0 ? `${otherRejected} more reached the position but ${otherRejected === 1 ? 'was' : 'were'} not recorded. ` : ''}
          {notReached.length > 0
            ? `${notReached.length} ${notReached.length === 1 ? 'try' : 'tries'} did not reach the set position${furthest !== null && metric.unit === 'deg' ? ` (furthest ${formatPrimary(furthest, 'deg')})` : ''}. `
            : ''}
          {summary.holdMs.median !== null ? `Typical hold ${formatSeconds(summary.holdMs.median)}. ` : ''}
          Session of {formatDuration(session.durationMs)} on {formatDay(dateKeyOf(session.timestamp))} at {formatTime(session.timestamp)}.
        </p>
      </div>

      {/* What was observed. */}
      <div className={cx(card, 'px-4 py-3.5')}>
        <p className={label}>Estimates while held</p>
        {summary.validReps === 0 ? (
          <p className={cx('mt-1.5 text-[14px] leading-[21px]', soft)}>
            No repetition met every requirement, so there is no figure to report. Nothing has been filled in.
            {furthest !== null && metric.unit === 'deg' ? ` The furthest a try went was ${formatPrimary(furthest, 'deg')} of ${metric.label.toLowerCase()}.` : ''}
          </p>
        ) : (
          <>
            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
              <p className={cx('text-[13.5px] leading-5', soft)}>
                {metric.label}
                {definition.digits === 'fingers' && summary.primary.metric !== 'opposition' ? ', mean of the fingers seen' : ''}
              </p>
              <p className={cx('display nums text-[24px] leading-8', strong)}>{formatPrimary(summary.primary.median, metric.unit)}</p>
            </div>
            {summary.primary.sd !== null ? (
              <p className={cx('nums text-right text-[12.5px] leading-4', soft)}>
                across repetitions: {formatPrimary(summary.primary.min, metric.unit).replace('≈', '')} to {formatPrimary(summary.primary.max, metric.unit).replace('≈', '')}
                {metric.unit === 'deg' ? `, SD ${summary.primary.sd.toFixed(1)}°` : ''}
              </p>
            ) : null}
            {compare && previous ? (
              <p className={cx('nums mt-1.5 text-[13px] leading-5', soft)}>
                {compare.comparable
                  ? `${plain ? 'Your previous session' : 'Previous session of this kind'} (${formatDay(dateKeyOf(previous.timestamp))}): ${formatPrimary(previous.summary.primary.median, metric.unit)}.`
                  : `Not compared with the previous session: ${compare.differences.join(', ')}.`}
              </p>
            ) : null}
            <div className={cx('mt-2.5 space-y-3 border-t pt-2', rule)}>
              {shown.map((digit) => (
                <JointTable key={digit} session={session} digit={digit} tone={tone} plain={plain} />
              ))}
              {plain && digits.length > shown.length ? (
                <p className={cx('text-[12.5px] leading-5', soft)}>The other fingers seen were recorded too. Your therapist can see them.</p>
              ) : null}
            </div>
          </>
        )}
      </div>

      {/* How well it was captured. */}
      <div className={cx(card, 'px-4 py-3.5')}>
        <p className={label}>Capture quality</p>
        <dl className={cx('nums mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[13.5px] leading-5', soft)}>
          <dt>Usable tracking</dt>
          <dd className={cx('text-right font-bold', strong)}>{Math.round(session.quality.usable * 100)}% of the session</dd>
          <dt>Camera view</dt>
          <dd className={cx('text-right font-bold', strong)}>{summary.view ? VIEW_NAME[summary.view] : '–'}</dd>
          {!plain ? (
            <>
              <dt>Camera</dt>
              <dd className={cx('text-right', strong)}>
                {SETUP_NAME[session.capture.setup].title}
                {session.capture.width > 0 ? `, ${session.capture.width}×${session.capture.height}` : ''}
              </dd>
              <dt>Frame rate</dt>
              <dd className={cx('text-right', strong)}>{session.capture.fps !== null ? `${session.capture.fps.toFixed(1)} per second` : '–'}</dd>
              <dt>Hand</dt>
              <dd className={cx('text-right', strong)}>
                {session.hand}
                {session.detectedHand && session.detectedHand !== session.hand ? ` set; tracker saw ${session.detectedHand}` : ''}
              </dd>
              <dt>Frames discarded as jumps</dt>
              <dd className={cx('text-right', strong)}>{session.quality.jumps}</dd>
            </>
          ) : null}
        </dl>
        {reasons.length > 0 ? (
          <p className={cx('mt-2 text-[12.5px] leading-5', soft)}>
            Measurement paused for: {reasons.map(([reason]) => REASON_WORD[reason].toLowerCase()).join('; ')}.
          </p>
        ) : null}
        {concerns.length > 0 ? (
          <ul className={cx('mt-2 space-y-0.5 rounded-[12px] px-3 py-2 text-[13px] leading-5', dark ? 'bg-amber-100/10 text-amber-100' : 'bg-amber-50 text-amber-700')}>
            {concerns.map((concern) => (
              <li key={concern}>{concern}.</li>
            ))}
          </ul>
        ) : null}
      </div>

      {!plain ? (
        <div className={cx(card, 'px-4 py-3')}>
          <p className={label}>Repetitions</p>
          <ol className="nums mt-1">
            {session.reps.map((rep) => (
              <li key={rep.attempt} className={cx('flex items-baseline justify-between gap-3 border-t py-1.5 text-[13px] leading-5 first:border-t-0', rule)}>
                <span className={cx('font-semibold', rep.valid ? strong : soft)}>
                  {rep.attempt}. {rep.valid ? 'Valid' : `Rejected: ${REJECT_WORD[rep.rejectReason ?? 'hold-too-short'].toLowerCase()}`}
                  {rep.valid && !rep.returned ? ' (return not seen)' : ''}
                </span>
                <span className={cx('text-right', soft)}>
                  {rep.valid
                    ? `${formatPrimary(rep.primary, metric.unit)}, held ${formatSeconds(rep.holdMs)}`
                    : rep.rejectReason === 'target-not-reached'
                      ? `furthest ${formatPrimary(rep.primary, metric.unit)}`
                      : `held ${formatSeconds(rep.holdMs)}`}
                  {rep.valid && rep.holdSd !== null && metric.unit === 'deg' ? `, ±${rep.holdSd.toFixed(1)}°` : ''}
                </span>
              </li>
            ))}
            {session.reps.length === 0 ? <li className={cx('py-1.5 text-[13px]', soft)}>The target position was never reached.</li> : null}
          </ol>
          <p className={cx('mt-2 border-t pt-2 text-[12px] leading-[18px]', rule, soft)}>
            {session.tracking.model}, running on {session.tracking.delegate === 'none' ? 'no model (replayed landmarks)' : session.tracking.delegate}. {session.tracking.filter}. Engine{' '}
            {session.tracking.engine}; {definition.title} version {session.definitionVersion}; joints accepted: “{GRADE_WORD[session.minGrade].tag.toLowerCase()}” or better.
          </p>
        </div>
      ) : null}

      <p className={cx('px-1 text-[12.5px] leading-5', soft)}>
        {session.source === 'camera' ? ESTIMATE_NOTE : SOURCE_WORD[session.source].note}
      </p>
    </div>
  );
}
