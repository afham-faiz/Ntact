/**
 * Sound for a session: short tones for what just happened, and optional spoken
 * instructions. A phone pointed at the hand often cannot be seen by the person
 * using it, so the session has to be followable by ear. Every cue is also shown
 * on screen: sound is never the only way anything is said.
 */

export type Tone = 'ready' | 'reached' | 'recorded' | 'rejected' | 'complete';

const NOTES: Record<Tone, { hz: number[]; ms: number }> = {
  ready: { hz: [523], ms: 90 },
  reached: { hz: [659], ms: 90 },
  recorded: { hz: [659, 880], ms: 110 },
  rejected: { hz: [330, 262], ms: 130 },
  complete: { hz: [659, 784, 1047], ms: 130 },
};

interface AudioWindow {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

export class Cues {
  private context: AudioContext | null = null;
  private lastSpoken = '';
  private lastSpokenAt = -Infinity;
  sound = true;
  voice = false;

  /** Call from a tap: browsers only allow sound that a person started. */
  unlock(): void {
    if (this.context || typeof window === 'undefined') return;
    try {
      const Context = (window as unknown as AudioWindow).AudioContext ?? (window as unknown as AudioWindow).webkitAudioContext;
      if (Context) this.context = new Context();
      void this.context?.resume();
    } catch {
      this.context = null;
    }
  }

  tone(kind: Tone): void {
    const context = this.context;
    if (!this.sound || !context) return;
    try {
      const { hz, ms } = NOTES[kind];
      hz.forEach((frequency, index) => {
        const start = context.currentTime + (index * ms) / 1000;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.16, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + ms / 1000);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + ms / 1000 + 0.02);
      });
    } catch {
      // Sound is a convenience. The screen says the same thing.
    }
  }

  /** Speaks an instruction, at most once every few seconds and never the same one twice in a row. */
  say(text: string, now: number, urgent = false): void {
    if (!this.voice || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (text === this.lastSpoken && now - this.lastSpokenAt < 9000) return;
    if (!urgent && now - this.lastSpokenAt < 2600) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-GB';
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
      this.lastSpoken = text;
      this.lastSpokenAt = now;
    } catch {
      // No voice on this device.
    }
  }

  static get voiceAvailable(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  close(): void {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
      void this.context?.close();
    } catch {
      // Already closed.
    }
    this.context = null;
  }
}
