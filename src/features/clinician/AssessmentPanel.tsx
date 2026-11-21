/**
 * Movement assessments in the clinician record.
 *
 * Everything on these panels is for review by a clinician. Nothing here makes a
 * decision, raises a flag or scores recovery. Three things are kept apart:
 *
 *   completion   were sessions done, and how many repetitions were valid
 *   estimates    the joint-angle estimates, with how each joint was seen
 *   quality      how well each session was captured
 *
 * and a fourth is shown beside them, never merged with them: the sensory test
 * results from the wearable, which measure something else.
 */
import { useMemo, useState } from 'react';
import { ASSESSMENT_ORDER, DEFINITIONS, METRIC_WORDS, protocolFor, resolveAssessment, resolveParams } from '../../assessment/definitions';
import { agreement, betweenSessions, comparability, previousOf, qualityConcerns, referencePairs, sessionsOf, withinSession } from '../../assessment/session';
import type { AssessmentId, AssessmentProtocol, AssessmentSession, ProtocolOverride } from '../../assessment/types';
import { useElementWidth } from '../../app/hooks';
import { useToast } from '../../components/Toast';
import { Button, Panel, Segmented, cx } from '../../components/ui';
import { demoStore } from '../../demo/store';
import { dateKeyOf, daysBetween, formatDayShort, formatTime, lastDays, type DateKey } from '../../domain/dates';
import { buildDaySeries, testsForPatient } from '../../domain/selectors';
import type { DemoState, Finger, Patient } from '../../domain/types';
import { DIGIT_JOINTS, type Grade, type JointId } from '../../tracking/geometry';
import { SessionReport, SourceTag } from '../movement/SessionReport';
import { TrendChart, TrendKey, trendPoints } from '../movement/TrendChart';
import { ESTIMATE_NOTE, FINGER_NAME, GRADE_WORD, JOINT_NAME, VIEW_NAME, formatAngle, formatPrimary } from '../movement/words';

type Measure = 'primary' | `${Finger}.${JointId}.${'flex' | 'ext' | 'arc'}`;

const KIND_WORD = { flex: 'held', ext: 'start', arc: 'arc' } as const;

function measureValue(session: AssessmentSession, measure: Measure): number | null {
  if (measure === 'primary') return session.summary.primary.median;
  const [finger, joint, kind] = measure.split('.') as [Finger, JointId, 'flex' | 'ext' | 'arc'];
  return session.summary.joints[finger]?.[joint]?.[kind] ?? null;
}

function measureLabel(measure: Measure, assessmentId: AssessmentId): string {
  if (measure === 'primary') return METRIC_WORDS[DEFINITIONS[assessmentId].primary].label;
  const [finger, joint, kind] = measure.split('.') as [Finger, JointId, 'flex' | 'ext' | 'arc'];
  return `${FINGER_NAME[finger]} ${JOINT_NAME[joint].short}, ${KIND_WORD[kind]}`;
}

const selectClass = 'h-10 rounded-[10px] border border-rule bg-paper px-3 text-[14px] font-semibold text-ink hover:border-ink/30';
const inputClass = 'nums h-9 w-[84px] rounded-[9px] border border-rule bg-paper px-2.5 text-right text-[14px] font-semibold text-ink hover:border-ink/30';

// ---------- Movement beside sensation ----------

/**
 * Two rows on one date axis: a movement estimate, and the detection level from
 * the sensory test. They are drawn together so a clinician can look at both; they
 * are never combined, and neither is said to explain the other.
 */
function TogetherTimeline({ sessions, measure, state, patient, today, unit }: { sessions: AssessmentSession[]; measure: Measure; state: DemoState; patient: Patient; today: DateKey; unit: 'deg' | 'palm' }) {
  const [ref, width] = useElementWidth<HTMLDivElement>(640);
  const span = 42;
  const days = lastDays(today, span);
  const first = days[0];
  const series = useMemo(() => buildDaySeries(testsForPatient(state.tests, patient.id), today, span), [state.tests, patient.id, today]);
  const points = trendPoints(
    sessions.filter((session) => dateKeyOf(session.timestamp) >= first),
    (session) => measureValue(session, measure),
  );

  const left = 46;
  const right = 12;
  const title = 18;
  const rowHeight = 84;
  const gap = 14;
  const height = (title + rowHeight) * 2 + gap + 22;
  const x = (day: DateKey) => left + (daysBetween(first, day) / (span - 1)) * (width - left - right);
  const values = points.map((point) => point.value);
  const low = values.length > 0 ? Math.min(...values) : 0;
  const high = values.length > 0 ? Math.max(...values) : 1;
  const pad = (high - low || 1) * 0.15;
  const yMove = (value: number) => title + 8 + (1 - (value - (low - pad)) / (high - low + 2 * pad || 1)) * (rowHeight - 16);
  const top2 = title + rowHeight + gap;
  const yLevel = (level: number) => top2 + title + 8 + (1 - (level - 1) / 9) * (rowHeight - 16);
  const format = (value: number) => (unit === 'deg' ? `${Math.round(value)}°` : value.toFixed(2));
  const felt = series.filter((point) => point.kind === 'FELT');

  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block" role="img" aria-label="A movement estimate and the sensory detection level over the last six weeks, on the same dates">
        {/* Movement row */}
        <text x={0} y={12} fontSize="11.5" fontWeight="700" fill="#14213D">Movement estimate</text>
        <line x1={left} x2={width - right} y1={title + rowHeight} y2={title + rowHeight} stroke="#E2E7F0" />
        {values.length > 0 ? (
          <>
            <text x={left - 6} y={yMove(high) + 4} textAnchor="end" fontSize="10.5" fill="#55617A" className="nums">{format(high)}</text>
            <text x={left - 6} y={yMove(low) + 4} textAnchor="end" fontSize="10.5" fill="#55617A" className="nums">{format(low)}</text>
          </>
        ) : (
          <text x={left + 8} y={title + rowHeight / 2} fontSize="12" fill="#97A1B5">No session in this period</text>
        )}
        {points.map((point) => {
          const cx0 = x(dateKeyOf(point.session.timestamp));
          const colour = point.comparable ? '#2E4A7D' : '#97A1B5';
          return (
            <g key={point.session.id}>
              {point.concern ? <circle cx={cx0} cy={yMove(point.value)} r="7" fill="none" stroke="#D98A10" strokeWidth="1.5" /> : null}
              <circle cx={cx0} cy={yMove(point.value)} r={point.session.synthetic ? 3.2 : 4.2} fill={point.session.synthetic ? '#ffffff' : colour} stroke={colour} strokeWidth="1.7" />
            </g>
          );
        })}

        {/* Sensation row */}
        <text x={0} y={top2 + 12} fontSize="11.5" fontWeight="700" fill="#14213D">Sensory test: vibration level detected</text>
        <line x1={left} x2={width - right} y1={top2 + title + rowHeight} y2={top2 + title + rowHeight} stroke="#E2E7F0" />
        <text x={left - 6} y={yLevel(10) + 4} textAnchor="end" fontSize="10.5" fill="#55617A">level 10</text>
        <text x={left - 6} y={yLevel(1) + 4} textAnchor="end" fontSize="10.5" fill="#55617A">level 1</text>
        {felt.map((point) => (
          <circle key={point.date} cx={x(point.date)} cy={yLevel(point.step as number)} r="3" fill="#ffffff" stroke="#6B82CF" strokeWidth="1.7" />
        ))}
        {series
          .filter((point) => point.kind === 'NO_FELT')
          .map((point) => (
            <path key={point.date} d={`M${x(point.date) - 3} ${top2 + title + rowHeight - 7}h6`} stroke="#6B82CF" strokeWidth="1.8" strokeLinecap="round" />
          ))}

        <text x={left} y={height - 6} fontSize="11" fill="#55617A">{formatDayShort(first)}</text>
        <text x={width - right} y={height - 6} textAnchor="end" fontSize="11" fill="#55617A">{formatDayShort(today)}</text>
      </svg>
    </div>
  );
}

// ---------- Comparing two sessions ----------

function CompareTable({ current, other }: { current: AssessmentSession; other: AssessmentSession }) {
  const result = comparability(current, other);
  const digits = (Object.keys(current.summary.joints) as Finger[]).filter((digit) => other.summary.joints[digit]);
  return (
    <div>
      <p className={cx('rounded-[10px] px-3 py-2 text-[13px] leading-5', result.comparable ? 'bg-teal-50 text-teal-700' : 'bg-amber-50 text-amber-700')}>
        {result.comparable
          ? 'Same assessment, hand, finger, camera view, engine and kind of data. The difference still includes the camera’s own variation, which has not been measured yet.'
          : `These two sessions should not be read against each other: ${result.differences.join(', ')}.`}
      </p>
      {result.comparable && digits.length > 0 ? (
        <table className="nums mt-2 w-full text-[13px] leading-5">
          <thead>
            <tr className="text-left text-[12px] text-ink-soft">
              <th className="py-1.5 font-semibold">Held estimate</th>
              <th className="py-1.5 text-right font-semibold">{formatDayShort(dateKeyOf(other.timestamp))}</th>
              <th className="py-1.5 text-right font-semibold">{formatDayShort(dateKeyOf(current.timestamp))}</th>
              <th className="py-1.5 text-right font-semibold">Difference</th>
            </tr>
          </thead>
          <tbody>
            {digits.flatMap((digit) =>
              DIGIT_JOINTS[digit]
                .filter((joint) => current.summary.joints[digit]?.[joint] && other.summary.joints[digit]?.[joint])
                .map((joint) => {
                  const now = current.summary.joints[digit]?.[joint]?.flex ?? null;
                  const then = other.summary.joints[digit]?.[joint]?.flex ?? null;
                  const change = now !== null && then !== null ? now - then : null;
                  return (
                    <tr key={`${digit}.${joint}`} className="border-t border-rule/70">
                      <th className="py-1.5 text-left font-semibold text-ink">
                        {FINGER_NAME[digit]} {JOINT_NAME[joint].short}
                      </th>
                      <td className="py-1.5 text-right text-ink-soft">{formatAngle(then)}</td>
                      <td className="py-1.5 text-right font-bold text-ink">{formatAngle(now)}</td>
                      <td className="py-1.5 text-right text-ink">{change === null ? '–' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(Math.round(change))}°`}</td>
                    </tr>
                  );
                }),
            )}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

// ---------- Reference readings ----------

function ReferenceReadings({ session, all }: { session: AssessmentSession; all: AssessmentSession[] }) {
  const toast = useToast();
  const digits = Object.keys(session.summary.joints) as Finger[];
  const [finger, setFinger] = useState<Finger>(digits.includes(session.focus) ? session.focus : (digits[0] ?? session.focus));
  const [joint, setJoint] = useState<JointId>('pip');
  const [kind, setKind] = useState<'flex' | 'ext'>('flex');
  const [degrees, setDegrees] = useState('');
  const joints = DIGIT_JOINTS[finger];
  const chosenJoint = joints.includes(joint) ? joint : joints[0];
  const pairs = referencePairs(all);
  const overall = agreement(pairs);
  const value = Number(degrees);
  const valid = degrees.trim() !== '' && Number.isFinite(value) && value >= -40 && value <= 140;

  return (
    <div>
      <p className="text-[13px] leading-5 text-ink-soft">
        For comparing the camera’s estimates with a reference instrument. Enter a reading taken at the same visit, for the same
        joint and position. This is a research aid: nothing is reported as accuracy from it until a planned study has been done.
      </p>
      {digits.length === 0 ? (
        <p className="mt-2 text-[13px] leading-5 text-ink-soft">This session has no estimates to compare with.</p>
      ) : (
        <div className="mt-2.5 flex flex-wrap items-end gap-2.5">
          <label className="text-[12px] font-semibold text-ink-soft">
            Finger
            <select value={finger} onChange={(event) => setFinger(event.target.value as Finger)} className={cx(selectClass, 'mt-1 block')}>
              {digits.map((digit) => (
                <option key={digit} value={digit}>
                  {FINGER_NAME[digit]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12px] font-semibold text-ink-soft">
            Joint
            <select value={chosenJoint} onChange={(event) => setJoint(event.target.value as JointId)} className={cx(selectClass, 'mt-1 block')}>
              {joints.map((item) => (
                <option key={item} value={item}>
                  {JOINT_NAME[item].short}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12px] font-semibold text-ink-soft">
            Position
            <select value={kind} onChange={(event) => setKind(event.target.value as 'flex' | 'ext')} className={cx(selectClass, 'mt-1 block')}>
              <option value="flex">Held (flexed)</option>
              <option value="ext">Start (extended)</option>
            </select>
          </label>
          <label className="text-[12px] font-semibold text-ink-soft">
            Goniometer, degrees
            <input value={degrees} onChange={(event) => setDegrees(event.target.value)} inputMode="decimal" className={cx(inputClass, 'mt-1 block h-10 w-[120px]')} placeholder="e.g. 85" />
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={!valid}
            onClick={() => {
              demoStore.addReferenceReading(session.id, { finger, joint: chosenJoint, kind, deg: value, instrument: 'Finger goniometer' });
              setDegrees('');
              toast.show('Reference reading saved locally.');
            }}
          >
            Add reading
          </Button>
        </div>
      )}

      {(session.references ?? []).length > 0 ? (
        <ul className="nums mt-3 divide-y divide-rule/70 border-t border-rule">
          {(session.references ?? []).map((reading) => {
            const summary = session.summary.joints[reading.finger]?.[reading.joint];
            const estimate = reading.kind === 'flex' ? summary?.flex : summary?.ext;
            return (
              <li key={reading.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 text-[13px] leading-5">
                <span className="font-semibold text-ink">
                  {FINGER_NAME[reading.finger]} {JOINT_NAME[reading.joint].short}, {KIND_WORD[reading.kind]}
                </span>
                <span className="text-ink-soft">
                  goniometer {Math.round(reading.deg)}° · camera {formatAngle(estimate)} ·{' '}
                  <span className="font-bold text-ink">
                    {estimate === null || estimate === undefined ? 'no estimate to compare' : `difference ${estimate - reading.deg > 0 ? '+' : ''}${Math.round(estimate - reading.deg)}°`}
                  </span>
                  <button type="button" onClick={() => demoStore.removeReferenceReading(session.id, reading.id)} className="ml-3 font-semibold text-ink underline decoration-rule underline-offset-2">
                    Remove
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {overall.n > 0 ? (
        <p className="nums mt-3 rounded-[10px] bg-floor px-3 py-2 text-[13px] leading-5 text-ink">
          Across this patient’s {overall.n} {overall.n === 1 ? 'pair' : 'pairs'}: mean difference (camera minus goniometer){' '}
          <span className="font-bold">{overall.bias !== null ? `${overall.bias > 0 ? '+' : ''}${overall.bias.toFixed(1)}°` : '–'}</span>
          {overall.lower !== null && overall.upper !== null ? `, 95% limits of agreement ${overall.lower.toFixed(1)}° to ${overall.upper.toFixed(1)}°` : ''}.{' '}
          <span className="text-ink-soft">A handful of pairs from one person describes those pairs only. It is not a validation result.</span>
        </p>
      ) : null}
    </div>
  );
}

// ---------- The review panel ----------

export function AssessmentReviewPanel({ patient, state, today }: { patient: Patient; state: DemoState; today: DateKey }) {
  const all = useMemo(() => sessionsOf(state.assessmentSessions ?? [], patient.id), [state.assessmentSessions, patient.id]);
  const available = ASSESSMENT_ORDER.filter((id) => all.some((session) => session.assessmentId === id));
  const protocol = protocolFor(state.assessmentProtocols, patient.id);
  const [chosen, setChosen] = useState<AssessmentId>('composite-fist');
  const assessmentId = available.includes(chosen) ? chosen : (available[0] ?? 'composite-fist');
  const sessions = useMemo(() => all.filter((session) => session.assessmentId === assessmentId), [all, assessmentId]);
  const [measure, setMeasure] = useState<Measure>('primary');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<'report' | 'compare' | 'reference'>('report');
  const [rows, setRows] = useState(6);

  const definition = DEFINITIONS[assessmentId];
  const metric = METRIC_WORDS[definition.primary];
  const digitsSeen = useMemo(() => {
    const seen = new Set<Finger>();
    for (const session of sessions) for (const digit of Object.keys(session.summary.joints) as Finger[]) seen.add(digit);
    return (['thumb', 'index', 'middle', 'ring', 'little'] as Finger[]).filter((digit) => seen.has(digit));
  }, [sessions]);
  const measureOptions: Measure[] = ['primary', ...digitsSeen.flatMap((digit) => DIGIT_JOINTS[digit].flatMap((joint) => (['flex', 'ext', 'arc'] as const).map((kind) => `${digit}.${joint}.${kind}` as Measure)))];
  const activeMeasure = measureOptions.includes(measure) ? measure : 'primary';
  const pick = useMemo(() => (session: AssessmentSession) => measureValue(session, activeMeasure), [activeMeasure]);
  const points = trendPoints(sessions, pick);
  const unit = activeMeasure === 'primary' ? metric.unit : 'deg';

  const selected = sessions.find((session) => session.id === selectedId) ?? sessions[sessions.length - 1] ?? null;
  const previous = selected ? previousOf(all, selected) : null;
  const latestCamera = [...sessions].reverse().find((session) => session.source === 'camera') ?? null;
  const within = selected ? withinSession(selected) : null;
  const between = betweenSessions(sessions.filter((session) => selected && session.source === selected.source));

  const week = lastDays(today, 7);
  const month = lastDays(today, 28);
  const dayCount = (days: DateKey[]) => days.filter((day) => all.some((session) => dateKeyOf(session.timestamp) === day)).length;
  const lastMonth = all.filter((session) => dateKeyOf(session.timestamp) >= month[0]);
  const validReps = lastMonth.reduce((sum, session) => sum + session.summary.validReps, 0);
  const rejectedReps = lastMonth.reduce((sum, session) => sum + session.summary.rejectedReps, 0);

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-6 pt-5">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold leading-6 tracking-[-0.02em] text-ink">Movement assessments</h2>
          <p className="mt-0.5 max-w-[74ch] text-[13px] leading-5 text-ink-soft">
            Joint-angle estimates from the patient’s camera, with how each joint was seen. {ESTIMATE_NOTE} For review only: nothing
            on this panel raises a flag or scores recovery.
          </p>
        </div>
        {latestCamera ? null : (
          <span className="hatch rounded-[8px] border border-dashed border-ink/30 px-2.5 py-1 text-[12px] font-semibold leading-5 text-ink-soft">
            No camera session yet: illustrative data only
          </span>
        )}
      </div>

      {all.length === 0 ? (
        <p className="px-6 pb-6 pt-4 text-[14px] leading-6 text-ink-soft">No movement assessment on record.</p>
      ) : (
        <>
          {/* Completion, kept apart from the estimates. */}
          <dl className="mx-6 mt-4 grid grid-cols-2 gap-x-6 gap-y-2 rounded-[12px] bg-floor px-4 py-3 sm:grid-cols-4">
            {[
              { label: 'Days with a session, last 7', value: `${dayCount(week)} of 7` },
              { label: 'Days with a session, last 28', value: `${dayCount(month)} of 28` },
              { label: 'Valid repetitions, last 28 days', value: String(validReps) },
              { label: 'Rejected repetitions, last 28 days', value: String(rejectedReps) },
            ].map((item) => (
              <div key={item.label}>
                <dt className="text-[12px] leading-4 text-ink-soft">{item.label}</dt>
                <dd className="nums mt-0.5 text-[16px] font-bold leading-6 text-ink">{item.value}</dd>
              </div>
            ))}
            <p className="col-span-full text-[12px] leading-4 text-ink-faint">Completion only: whether sessions were done. It says nothing about the hand.</p>
          </dl>

          <div className="flex flex-wrap items-center gap-3 px-6 pt-5">
            <Segmented<AssessmentId>
              options={available.map((id) => ({ value: id, label: DEFINITIONS[id].title }))}
              value={assessmentId}
              onChange={(value) => {
                setChosen(value);
                setSelectedId(null);
                setMeasure('primary');
              }}
              label="Assessment"
              size="sm"
            />
            <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-soft">
              Plot
              <select value={activeMeasure} onChange={(event) => setMeasure(event.target.value as Measure)} className={selectClass} aria-label="Quantity to plot">
                {measureOptions.map((option) => (
                  <option key={option} value={option}>
                    {measureLabel(option, assessmentId)}
                    {option === 'primary' && definition.digits === 'fingers' ? ' (mean of fingers seen)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {protocol.enabled.includes(assessmentId) ? null : <span className="text-[12.5px] font-semibold text-amber-700">Not currently offered to this patient</span>}
          </div>

          <div className="px-6 pt-3">
            <p className="text-[12.5px] leading-5 text-ink-soft">
              {definition.clinical}. Each point is one session’s median across its valid repetitions. Select a point for the session.
            </p>
            <TrendChart sessions={sessions} pick={pick} unit={unit} height={190} selectedId={selected?.id ?? null} onSelect={(session) => setSelectedId(session.id)} label={measureLabel(activeMeasure, assessmentId)} />
            <TrendKey points={points} />
          </div>

          <div className="mx-6 mt-5 rounded-[14px] border border-rule bg-white/60 px-4 py-4">
            <p className="text-[13.5px] font-bold leading-5 text-ink">Beside the sensory test</p>
            <p className="mb-2 max-w-[80ch] text-[12.5px] leading-5 text-ink-soft">
              The same six weeks, on one date axis: this movement estimate above, the vibration level the patient detected on the
              wearable below (a lower level is a gentler vibration; a dash on the baseline is a test that was not felt). Movement
              and sensation are different things. They are shown together for review and are never combined into one figure.
            </p>
            <TogetherTimeline sessions={sessions} measure={activeMeasure} state={state} patient={patient} today={today} unit={unit} />
          </div>

          {/* Sessions */}
          <div className="mt-5 overflow-x-auto border-t border-rule">
            <table className="nums w-full min-w-[640px] text-[13.5px] leading-5">
              <thead>
                <tr className="text-left text-[12px] text-ink-soft">
                  <th className="px-6 py-2.5 font-semibold">Session</th>
                  <th className="px-3 py-2.5 font-semibold">Repetitions</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{metric.label}</th>
                  <th className="px-3 py-2.5 font-semibold">View</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Usable</th>
                  <th className="px-6 py-2.5 font-semibold">Data</th>
                </tr>
              </thead>
              <tbody>
                {[...sessions]
                  .reverse()
                  .slice(0, rows)
                  .map((session) => {
                    const concerns = qualityConcerns(session);
                    const active = selected?.id === session.id;
                    return (
                      <tr
                        key={session.id}
                        onClick={() => setSelectedId(session.id)}
                        aria-selected={active}
                        className={cx('cursor-pointer border-t border-rule/70', active ? 'bg-teal-50/70' : 'hover:bg-floor')}
                      >
                        <td className="px-6 py-2.5 text-ink">
                          <button type="button" className="text-left font-semibold underline decoration-rule underline-offset-2" onClick={() => setSelectedId(session.id)}>
                            {formatDayShort(dateKeyOf(session.timestamp))}
                          </button>
                          <span className="text-ink-soft">, {formatTime(session.timestamp)}</span>
                        </td>
                        <td className="px-3 py-2.5 text-ink">
                          <span className="font-bold">
                            {session.summary.validReps}/{session.summary.targetReps}
                          </span>{' '}
                          valid
                          {session.summary.rejectedReps > 0 ? <span className="text-ink-soft">, {session.summary.rejectedReps} rejected</span> : null}
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-ink">{formatPrimary(session.summary.primary.median, metric.unit).replace(' palm lengths', '')}</td>
                        <td className="px-3 py-2.5 text-ink-soft">{session.summary.view ? VIEW_NAME[session.summary.view] : '–'}</td>
                        <td className={cx('px-3 py-2.5 text-right', concerns.length > 0 ? 'font-bold text-amber-700' : 'text-ink-soft')}>
                          {Math.round(session.quality.usable * 100)}%{concerns.length > 0 ? ' !' : ''}
                          {concerns.length > 0 ? <span className="sr-only-live"> Capture-quality concern: {concerns.join('; ')}</span> : null}
                        </td>
                        <td className="px-6 py-2.5">
                          <SourceTag session={session} />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {sessions.length > rows ? (
            <button type="button" onClick={() => setRows(rows + 12)} className="w-full border-t border-rule py-3 text-[14px] font-semibold text-ink hover:bg-floor">
              Show earlier sessions
            </button>
          ) : null}

          {selected ? (
            <div className="border-t border-rule px-6 pb-6 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-[15.5px] font-bold leading-6 text-ink">
                  {definition.title}, {formatDayShort(dateKeyOf(selected.timestamp))} at {formatTime(selected.timestamp)}
                </h3>
                <Segmented<'report' | 'compare' | 'reference'>
                  options={[
                    { value: 'report', label: 'Session' },
                    { value: 'compare', label: 'Compare' },
                    { value: 'reference', label: 'Reference readings' },
                  ]}
                  value={detail}
                  onChange={setDetail}
                  label="Session detail"
                  size="sm"
                />
              </div>

              {detail === 'report' ? (
                <>
                  <SessionReport session={selected} previous={previous} audience="clinical" className="mt-3" />
                  <p className="nums mt-3 text-[12.5px] leading-5 text-ink-soft">
                    Repeatability, {metric.label.toLowerCase()}: within this session, SD{' '}
                    {within?.sd != null ? (metric.unit === 'deg' ? `${within.sd.toFixed(1)}°` : within.sd.toFixed(3)) : 'needs two valid repetitions'} across {within?.n ?? 0}{' '}
                    {within?.n === 1 ? 'repetition' : 'repetitions'}; between comparable sessions of the same kind, SD{' '}
                    {between.sd != null ? (metric.unit === 'deg' ? `${between.sd.toFixed(1)}°` : between.sd.toFixed(3)) : 'needs two sessions'} across {between.n}. The
                    between-session figure includes any real change in the hand over that time.
                  </p>
                </>
              ) : null}

              {detail === 'compare' ? (
                <div className="mt-3">
                  {previous ? (
                    <CompareTable current={selected} other={previous} />
                  ) : (
                    <p className="text-[13.5px] leading-5 text-ink-soft">There is no earlier session of this assessment and this kind of data to compare with.</p>
                  )}
                </div>
              ) : null}

              {detail === 'reference' ? (
                <div className="mt-3">
                  <ReferenceReadings key={selected.id} session={selected} all={all} />
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}

// ---------- The protocol ----------

const UNIT_WORD = { deg: '°', s: 's', reps: '', palm: 'palm lengths' } as const;

export function ProtocolPanel({ patient, state }: { patient: Patient; state: DemoState }) {
  const toast = useToast();
  const protocol = protocolFor(state.assessmentProtocols, patient.id);
  const [open, setOpen] = useState<AssessmentId | null>(null);

  const save = (next: AssessmentProtocol, message: string) => {
    demoStore.setAssessmentProtocol(patient.id, next);
    toast.show(`${message} Saved locally.`);
  };
  const override = (id: AssessmentId, patch: ProtocolOverride): AssessmentProtocol => ({
    enabled: protocol.enabled,
    overrides: { ...protocol.overrides, [id]: { ...protocol.overrides[id], ...patch } },
  });

  return (
    <Panel>
      <div className="px-6 pt-5">
        <h2 className="text-[17px] font-bold leading-6 tracking-[-0.02em] text-ink">Assessment protocol</h2>
        <p className="mt-0.5 text-[13px] leading-5 text-ink-soft">
          Which movement assessments this patient is offered, and how each is detected. You decide: the app never switches one on
          by itself. These are demonstration assessments with detection thresholds, not therapeutic targets or normal ranges.
        </p>
      </div>
      <ul className="mt-2 divide-y divide-rule/70 px-6 pb-4">
        {ASSESSMENT_ORDER.map((id) => {
          const definition = DEFINITIONS[id];
          const enabled = protocol.enabled.includes(id);
          const current = protocol.overrides[id];
          const params = resolveParams(definition, current);
          const resolved = resolveAssessment(id, patient.finger, current);
          const changed = definition.params.some((spec) => params[spec.key] !== spec.default) || (current?.minGrade ?? 'inferred') !== 'inferred' || current?.finger !== undefined;
          return (
            <li key={id} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-[14px] font-bold leading-5 text-ink">
                    {definition.title}
                    {definition.maturity === 'exploratory' ? <span className="ml-2 text-[11.5px] font-semibold text-ink-faint">Exploratory</span> : null}
                  </span>
                  <span className={cx('block text-[12.5px] leading-5', enabled ? 'text-teal-700' : 'text-ink-soft')}>
                    {enabled ? 'Offered to this patient' : 'Not offered'}
                    {changed ? ' · settings changed' : ''}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1.5">
                  <Button variant="ghost" size="xs" onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id}>
                    {open === id ? 'Close' : 'Settings'}
                  </Button>
                  <Button
                    variant={enabled ? 'outline' : 'primary'}
                    size="xs"
                    onClick={() =>
                      save(
                        { enabled: enabled ? protocol.enabled.filter((item) => item !== id) : [...protocol.enabled, id], overrides: protocol.overrides },
                        `${definition.title} ${enabled ? 'withdrawn' : 'offered'}.`,
                      )
                    }
                  >
                    {enabled ? 'Withdraw' : 'Offer'}
                  </Button>
                </span>
              </div>

              {open === id ? (
                <div className="mt-3 rounded-[12px] bg-floor px-3.5 py-3">
                  <p className="text-[12.5px] leading-5 text-ink-soft">{definition.clinical}.</p>
                  <ul className="mt-2 space-y-2">
                    {definition.params.map((spec) => (
                      <li key={spec.key} className="flex items-center justify-between gap-3">
                        <label htmlFor={`${id}-${spec.key}`} className="min-w-0 text-[13px] leading-[18px] text-ink">
                          <span className="font-semibold">{spec.label}</span>
                          <span className="block text-[12px] text-ink-soft">{spec.help}</span>
                        </label>
                        <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-ink-soft">
                          <input
                            id={`${id}-${spec.key}`}
                            type="number"
                            min={spec.min}
                            max={spec.max}
                            step={spec.step}
                            value={params[spec.key]}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              if (!Number.isFinite(value)) return;
                              demoStore.setAssessmentProtocol(patient.id, override(id, { params: { ...current?.params, [spec.key]: Math.min(spec.max, Math.max(spec.min, value)) } }));
                            }}
                            className={inputClass}
                          />
                          <span className="w-[70px]">{UNIT_WORD[spec.unit] || (spec.unit === 'reps' ? 'reps' : '')}</span>
                        </span>
                      </li>
                    ))}
                    <li className="flex items-center justify-between gap-3">
                      <label htmlFor={`${id}-grade`} className="min-w-0 text-[13px] leading-[18px] text-ink">
                        <span className="font-semibold">Joints accepted</span>
                        <span className="block text-[12px] text-ink-soft">
                          “In view” accepts only joints that bend across the picture. “Depth-inferred” also accepts joints that bend along the line of sight, and labels them.
                        </span>
                      </label>
                      <select
                        id={`${id}-grade`}
                        value={current?.minGrade ?? 'inferred'}
                        onChange={(event) => save(override(id, { minGrade: event.target.value as Exclude<Grade, 'unavailable'> }), 'Setting changed.')}
                        className={cx(selectClass, 'h-9 shrink-0')}
                      >
                        <option value="inferred">{GRADE_WORD.inferred.tag} or better</option>
                        <option value="direct">{GRADE_WORD.direct.tag} only</option>
                      </select>
                    </li>
                    {definition.digits === 'one-finger' ? (
                      <li className="flex items-center justify-between gap-3">
                        <label htmlFor={`${id}-finger`} className="text-[13px] font-semibold leading-[18px] text-ink">
                          Finger
                        </label>
                        <select
                          id={`${id}-finger`}
                          value={resolved.focus}
                          onChange={(event) => save(override(id, { finger: event.target.value as Finger }), 'Setting changed.')}
                          className={cx(selectClass, 'h-9 shrink-0')}
                        >
                          {(['index', 'middle', 'ring', 'little'] as Finger[]).map((digit) => (
                            <option key={digit} value={digit}>
                              {FINGER_NAME[digit]}
                            </option>
                          ))}
                        </select>
                      </li>
                    ) : null}
                  </ul>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-[12px] leading-4 text-ink-faint">Changes apply from the patient’s next session and are stored with it.</p>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={!changed}
                      onClick={() => {
                        const overrides = { ...protocol.overrides };
                        delete overrides[id];
                        save({ enabled: protocol.enabled, overrides }, `${definition.title} reset to defaults.`);
                      }}
                    >
                      Reset to defaults
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
