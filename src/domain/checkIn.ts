/**
 * The daily check-in, defined as data.
 *
 * Ariz's guidance: keep it extremely short to protect adherence. The questions
 * live in a schema so they can be reworded, reordered or replaced, and so a
 * longer weekly check-in can be added later, without touching stored records.
 */
import type { CheckIn, CheckInAnswer, ColdSensitivity } from './types';

export type CheckInQuestion =
  | {
      id: string;
      kind: 'scale';
      prompt: string;
      min: number;
      max: number;
      minLabel: string;
      maxLabel: string;
    }
  | {
      id: string;
      kind: 'yesno';
      prompt: string;
      hint?: string;
      /** Optional free-text follow-up shown only after "Yes". */
      followUp?: { id: string; prompt: string; placeholder: string };
      /** Shown after "Yes". Signposting, never advice. */
      yesNote?: string;
    }
  | {
      id: string;
      kind: 'choice';
      prompt: string;
      options: { value: string; label: string; hint?: string }[];
    }
  | {
      id: string;
      kind: 'text';
      prompt: string;
      placeholder: string;
      optional: true;
      maxLength: number;
    };

export interface CheckInSchema {
  id: string;
  title: string;
  cadence: 'daily' | 'weekly';
  questions: CheckInQuestion[];
}

export const DAILY_CHECK_IN: CheckInSchema = {
  id: 'daily-v1',
  title: 'Daily check-in',
  cadence: 'daily',
  questions: [
    {
      id: 'pain',
      kind: 'scale',
      prompt: 'How much pain have you had today?',
      min: 0,
      max: 10,
      minLabel: 'No pain',
      maxLabel: 'Worst imaginable',
    },
    {
      id: 'skin',
      kind: 'yesno',
      prompt: 'Any new skin issues?',
      hint: 'Redness, blisters or sore spots on the finger or under the wearable.',
      followUp: { id: 'skinNote', prompt: 'What did you notice?', placeholder: 'A few words is plenty (optional)' },
      yesNote: 'If a skin change worries you, contact your care team. This prototype does not alert anyone.',
    },
    {
      id: 'cold',
      kind: 'choice',
      prompt: 'How sensitive to cold has your finger been?',
      options: [
        { value: 'none', label: 'None' },
        { value: 'mild', label: 'Mild' },
        { value: 'moderate', label: 'Moderate' },
        { value: 'severe', label: 'Severe' },
      ],
    },
    {
      id: 'note',
      kind: 'text',
      prompt: 'Anything else you want to note?',
      placeholder: 'Optional. A few words is plenty.',
      optional: true,
      maxLength: 240,
    },
  ],
};

export const CHECK_IN_SCHEMAS: Record<string, CheckInSchema> = {
  [DAILY_CHECK_IN.id]: DAILY_CHECK_IN,
};

/** True when every question that needs an answer has one. Text questions are optional. */
export function isComplete(schema: CheckInSchema, answers: Record<string, CheckInAnswer>): boolean {
  return schema.questions.every((question) => {
    if (question.kind === 'text') return true;
    const answer = answers[question.id];
    return answer !== undefined && answer !== null;
  });
}

/** First question still waiting for an answer, or the last index when all are answered. */
export function firstUnanswered(schema: CheckInSchema, answers: Record<string, CheckInAnswer>): number {
  const index = schema.questions.findIndex((question) => {
    if (question.kind === 'text') return false;
    const answer = answers[question.id];
    return answer === undefined || answer === null;
  });
  return index === -1 ? schema.questions.length - 1 : index;
}

// ---------- Typed reads, so charts and rules never poke at raw answers ----------

export function painOf(checkIn: CheckIn): number | null {
  const value = checkIn.answers.pain;
  return typeof value === 'number' && value >= 0 && value <= 10 ? value : null;
}

export function skinIssueOf(checkIn: CheckIn): boolean | null {
  const value = checkIn.answers.skin;
  return typeof value === 'boolean' ? value : null;
}

export function skinNoteOf(checkIn: CheckIn): string | null {
  const value = checkIn.answers.skinNote;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const COLD_VALUES: ColdSensitivity[] = ['none', 'mild', 'moderate', 'severe'];

export function coldOf(checkIn: CheckIn): ColdSensitivity | null {
  const value = checkIn.answers.cold;
  return typeof value === 'string' && (COLD_VALUES as string[]).includes(value) ? (value as ColdSensitivity) : null;
}

export function noteOf(checkIn: CheckIn): string | null {
  const value = checkIn.answers.note;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export const COLD_LABEL: Record<ColdSensitivity, string> = {
  none: 'None',
  mild: 'Mild',
  moderate: 'Moderate',
  severe: 'Severe',
};

export function describeCold(checkIn: CheckIn): string {
  const value = coldOf(checkIn);
  return value ? COLD_LABEL[value] : 'Not answered';
}

export function describeSkin(checkIn: CheckIn): string {
  const value = skinIssueOf(checkIn);
  if (value === null) return 'Not answered';
  return value ? 'New skin issue reported' : 'No new skin issues';
}

/** Tidy answers before saving: trim text, drop the follow-up when its trigger is not "Yes". */
export function normaliseAnswers(
  schema: CheckInSchema,
  answers: Record<string, CheckInAnswer>,
): Record<string, CheckInAnswer> {
  const result: Record<string, CheckInAnswer> = {};
  for (const question of schema.questions) {
    const answer = answers[question.id];
    if (question.kind === 'text') {
      if (typeof answer === 'string' && answer.trim()) result[question.id] = answer.trim().slice(0, question.maxLength);
      continue;
    }
    if (answer !== undefined && answer !== null) result[question.id] = answer;
    if (question.kind === 'yesno' && question.followUp && answer === true) {
      const followUp = answers[question.followUp.id];
      if (typeof followUp === 'string' && followUp.trim()) result[question.followUp.id] = followUp.trim().slice(0, 240);
    }
  }
  return result;
}
