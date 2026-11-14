import { describe, expect, it } from 'vitest';
import {
  CHECK_IN_SCHEMAS,
  DAILY_CHECK_IN,
  coldOf,
  describeCold,
  describeSkin,
  firstUnanswered,
  isComplete,
  normaliseAnswers,
  noteOf,
  painOf,
  skinIssueOf,
  skinNoteOf,
} from '../src/domain/checkIn';
import type { CheckInAnswer } from '../src/domain/types';
import { FIXED_DATE_KEY as TODAY, checkInOn } from './helpers';

const withAnswers = (answers: Record<string, CheckInAnswer>) => checkInOn(TODAY, answers);

describe('daily check-in schema', () => {
  it('has exactly four questions, in the order pain, skin, cold, note', () => {
    expect(DAILY_CHECK_IN.questions.map((question) => [question.id, question.kind])).toEqual([
      ['pain', 'scale'],
      ['skin', 'yesno'],
      ['cold', 'choice'],
      ['note', 'text'],
    ]);
    expect(DAILY_CHECK_IN.cadence).toBe('daily');
    expect(CHECK_IN_SCHEMAS[DAILY_CHECK_IN.id]).toBe(DAILY_CHECK_IN);
  });

  it('asks pain on a 0 to 10 scale', () => {
    const [pain] = DAILY_CHECK_IN.questions;
    if (pain.kind !== 'scale') throw new Error('expected a scale question');

    expect(pain.min).toBe(0);
    expect(pain.max).toBe(10);
  });

  it('asks about new skin issues as yes or no, with an optional follow-up note', () => {
    const skin = DAILY_CHECK_IN.questions[1];
    if (skin.kind !== 'yesno') throw new Error('expected a yes/no question');

    expect(skin.followUp?.id).toBe('skinNote');
  });

  it('offers exactly None, Mild, Moderate and Severe for cold sensitivity', () => {
    const cold = DAILY_CHECK_IN.questions[2];
    if (cold.kind !== 'choice') throw new Error('expected a choice question');

    expect(cold.options.map((option) => option.label)).toEqual(['None', 'Mild', 'Moderate', 'Severe']);
    expect(cold.options.map((option) => option.value)).toEqual(['none', 'mild', 'moderate', 'severe']);
  });

  it('makes the note optional free text with a length limit', () => {
    const note = DAILY_CHECK_IN.questions[3];
    if (note.kind !== 'text') throw new Error('expected a text question');

    expect(note.optional).toBe(true);
    expect(note.maxLength).toBeGreaterThan(0);
  });
});

describe('isComplete and firstUnanswered', () => {
  it('is complete once pain, skin and cold are answered: the optional note is ignored', () => {
    expect(isComplete(DAILY_CHECK_IN, { pain: 4, skin: true, cold: 'mild' })).toBe(true);
    expect(isComplete(DAILY_CHECK_IN, { pain: 4, skin: true, cold: 'mild', note: 'Slept badly.' })).toBe(true);
  });

  it('accepts "no pain" and "no" as answers: 0 and false are not blanks', () => {
    expect(isComplete(DAILY_CHECK_IN, { pain: 0, skin: false, cold: 'none' })).toBe(true);
  });

  it('is incomplete while any required answer is missing or null, whatever the note says', () => {
    expect(isComplete(DAILY_CHECK_IN, {})).toBe(false);
    expect(isComplete(DAILY_CHECK_IN, { skin: false, cold: 'none', note: 'All fine' })).toBe(false);
    expect(isComplete(DAILY_CHECK_IN, { pain: 2, cold: 'none' })).toBe(false);
    expect(isComplete(DAILY_CHECK_IN, { pain: 2, skin: false })).toBe(false);
    expect(isComplete(DAILY_CHECK_IN, { pain: 2, skin: null, cold: 'none' })).toBe(false);
  });

  it('points at the first question still waiting, and at the last one when everything is answered', () => {
    expect(firstUnanswered(DAILY_CHECK_IN, {})).toBe(0);
    expect(firstUnanswered(DAILY_CHECK_IN, { pain: 0 })).toBe(1);
    expect(firstUnanswered(DAILY_CHECK_IN, { pain: 0, skin: false })).toBe(2);
    expect(firstUnanswered(DAILY_CHECK_IN, { pain: 0, skin: false, cold: 'none' })).toBe(3);
  });
});

describe('typed accessors', () => {
  it('read well-formed answers', () => {
    const checkIn = withAnswers({
      pain: 6,
      skin: true,
      skinNote: '  Small blister  ',
      cold: 'moderate',
      note: ' Ached after a cold walk. ',
    });

    expect(painOf(checkIn)).toBe(6);
    expect(skinIssueOf(checkIn)).toBe(true);
    expect(skinNoteOf(checkIn)).toBe('Small blister');
    expect(coldOf(checkIn)).toBe('moderate');
    expect(noteOf(checkIn)).toBe('Ached after a cold walk.');
  });

  it('keep 0 and false as real answers', () => {
    const checkIn = withAnswers({ pain: 0, skin: false, cold: 'none' });

    expect(painOf(checkIn)).toBe(0);
    expect(skinIssueOf(checkIn)).toBe(false);
    expect(coldOf(checkIn)).toBe('none');
  });

  it('return null for missing answers', () => {
    const empty = withAnswers({});

    expect(painOf(empty)).toBeNull();
    expect(skinIssueOf(empty)).toBeNull();
    expect(skinNoteOf(empty)).toBeNull();
    expect(coldOf(empty)).toBeNull();
    expect(noteOf(empty)).toBeNull();
    expect(describeSkin(empty)).toBe('Not answered');
    expect(describeCold(empty)).toBe('Not answered');
  });

  it('return null for wrong-typed or out-of-range answers instead of passing them on', () => {
    const wrong = withAnswers({ pain: '6', skin: 'yes', skinNote: 3, cold: 'freezing', note: true });

    expect(painOf(wrong)).toBeNull();
    expect(skinIssueOf(wrong)).toBeNull();
    expect(skinNoteOf(wrong)).toBeNull();
    expect(coldOf(wrong)).toBeNull();
    expect(noteOf(wrong)).toBeNull();

    expect(painOf(withAnswers({ pain: 11 }))).toBeNull();
    expect(painOf(withAnswers({ pain: -1 }))).toBeNull();
    expect(coldOf(withAnswers({ cold: 2 }))).toBeNull();
    expect(noteOf(withAnswers({ note: '   ' }))).toBeNull();
  });
});

describe('normaliseAnswers', () => {
  it('trims text, keeps the follow-up only after "yes", and drops answers that belong to no question', () => {
    expect(
      normaliseAnswers(DAILY_CHECK_IN, {
        pain: 3,
        skin: true,
        skinNote: '  Red patch  ',
        cold: 'mild',
        note: '  Fine otherwise  ',
        mood: 'curious',
      }),
    ).toEqual({ pain: 3, skin: true, skinNote: 'Red patch', cold: 'mild', note: 'Fine otherwise' });

    expect(normaliseAnswers(DAILY_CHECK_IN, { pain: 3, skin: false, skinNote: 'Red patch', cold: 'mild' })).toEqual({
      pain: 3,
      skin: false,
      cold: 'mild',
    });
  });

  it('leaves out blank text and unanswered questions rather than storing empty values', () => {
    expect(normaliseAnswers(DAILY_CHECK_IN, { pain: 0, skin: null, skinNote: '   ', note: '   ' })).toEqual({ pain: 0 });
  });

  it('cuts the note at the schema’s maximum length', () => {
    const note = DAILY_CHECK_IN.questions[3];
    if (note.kind !== 'text') throw new Error('expected a text question');

    const saved = normaliseAnswers(DAILY_CHECK_IN, { note: 'x'.repeat(note.maxLength + 50) });

    expect(saved.note).toHaveLength(note.maxLength);
  });
});
