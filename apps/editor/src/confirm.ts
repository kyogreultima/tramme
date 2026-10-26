// A question the user answers before something happens (a generation that
// costs money, a transcription the assistant needs): asked in the conversation while the assistant works, in a
// dialog otherwise; the caller waits for the answer. When the assistant works
// on its own (its changes applied without the user), nothing is asked: each
// paid generation counts against the allowance of its turn (Sound settings),
// so a turn left alone never stops on a question.

import { signal } from '@preact/signals';
import { prefs } from './settings.ts';

export interface Question {
  title: string;
  text: string;
  yes: string;
  resolve: (yes: boolean) => void;
  /** asked during a turn of the assistant: shown in the conversation */
  inChat: boolean;
  /** a choice among pictures (the takes of a generation): each one picked by its index, none by the cancel */
  choices?: { url: string; label: string }[];
  choose?: (index: number) => void;
}

/** the question shown, if any */
export const question = signal<Question | null>(null);
/** conversations on screen that show the questions of a turn (otherwise the dialog does) */
export const chatShown = signal(0);

/** the turn of the assistant running, if any; auto when its changes apply without the user */
let turn: { auto: boolean; paid: number } | null = null;

export function turnBegins(auto: boolean) { turn = { auto, paid: 0 }; }
/** the turn is over: a question still open is answered no */
export function turnEnds() {
  turn = null;
  if (question.peek()?.inChat) answer(false);
}

/** the assistant works on its own this turn: nobody is there to answer */
export const alone = () => !!turn?.auto;

/** asks; a question still open is answered no */
export function confirmWith(title: string, text: string, yes: string): Promise<boolean> {
  return new Promise((resolve) => {
    question.peek()?.resolve(false);
    question.value = { title, text, yes, resolve, inChat: !!turn };
  });
}

/** asks the user before the assistant starts something only they decide (a transcription); a turn left alone is never asked: no */
export async function askUser(title: string, text: string, yes: string): Promise<boolean> {
  return !turn?.auto && confirmWith(title, text, yes);
}

/**
 * The user picks one picture among several (the takes of a generation):
 * its index, or null when they keep none. A turn left alone is never asked:
 * null, and the caller hands the choice to the assistant.
 */
export function chooseAmong(title: string, text: string, choices: { url: string; label: string }[]): Promise<number | null> {
  if (turn?.auto) return Promise.resolve(null);
  return new Promise((resolve) => {
    question.peek()?.resolve(false);
    question.value = {
      title, text, yes: '', choices, inChat: !!turn,
      resolve: () => resolve(null),
      choose: (i) => { question.value = null; resolve(i); },
    };
  });
}

/** the picture picked in the question shown */
export function choose(index: number) {
  question.peek()?.choose?.(index);
}

export function answer(yes: boolean) {
  const q = question.peek();
  question.value = null;
  q?.resolve(yes);
}

/**
 * A generation that costs money (`count` of them: the takes of a picture):
 * allowed by the turn's allowance when the assistant works on its own, by the
 * user's yes otherwise (unless the settings say not to ask). Throws when it is
 * not, saying what to do instead.
 */
export async function payFor(title: string, text: string, yes: string, instead: string, count = 1): Promise<void> {
  const p = prefs.peek();
  if (turn?.auto) {
    if (turn.paid + count > p.paidPerTurn) throw new Error(`the allowance of ${p.paidPerTurn} paid generations for this turn is used up (Sound settings): ${instead}, and tell the user what is left to make`);
    turn.paid += count;
    return;
  }
  if (p.confirmPaid && !await confirmWith(title, text, yes)) throw new Error(`the user declined (it costs money): ask before trying again, or ${instead}`);
}
