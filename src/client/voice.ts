/** Thin wrappers over the Web Speech API. Everything degrades gracefully when unsupported. */

type Rec = {
  lang: string; interimResults: boolean; maxAlternatives: number; continuous: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const RecCtor: (new () => Rec) | undefined =
  typeof window !== 'undefined' ? ((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as never : undefined;

export const canListen = !!RecCtor;
export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

let active: Rec | null = null;

export function listen(onPartial: (t: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!RecCtor) return reject(new Error('Speech recognition not supported in this browser'));
    active?.abort();
    const rec = new RecCtor();
    active = rec;
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText = text;
      }
      onPartial(text);
    };
    rec.onerror = (e) => {
      active = null;
      reject(new Error(e.error === 'not-allowed' ? 'Microphone permission denied' : e.error));
    };
    rec.onend = () => {
      active = null;
      resolve(finalText);
    };
    rec.start();
  });
}

export function stopListening() {
  active?.stop();
}

let voice: SpeechSynthesisVoice | null = null;
function pickVoice() {
  if (!canSpeak) return null;
  const vs = speechSynthesis.getVoices();
  voice = vs.find((v) => /en-(US|GB)/.test(v.lang) && /Daniel|Samantha|Google UK English Male|Alex|Aaron|Arthur/.test(v.name)) ?? vs.find((v) => v.lang.startsWith('en')) ?? null;
  return voice;
}
if (canSpeak) speechSynthesis.addEventListener?.('voiceschanged', pickVoice);

/** Speak a line. Urgent lines cut in front of anything queued. */
export function speak(text: string, urgent = false) {
  if (!canSpeak) return;
  if (urgent) speechSynthesis.cancel();
  else if (speechSynthesis.pending) return; // never let the backlog grow
  const u = new SpeechSynthesisUtterance(text.replace(/H\+/g, 'H plus ').replace(/\bVP\b/g, 'V P').replace(/\bCP\b/g, 'C P'));
  u.voice = voice ?? pickVoice();
  u.rate = 1.08;
  u.pitch = 0.95;
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (canSpeak) speechSynthesis.cancel();
}
