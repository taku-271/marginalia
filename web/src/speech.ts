import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 音声まわり(ブラウザ標準機能のみ。AWS は使わない)
 * - 読み上げ: speechSynthesis
 * - 音声入力: SpeechRecognition / webkitSpeechRecognition
 * 対応していないブラウザでは機能ごと隠す。キーボードの音声入力はどの環境でも使える。
 */

// ---------------------------------------------------------------- 読み上げ

export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

function japaneseVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang === "ja-JP" && v.localService) ?? voices.find((v) => v.lang.startsWith("ja"));
}

export function speak(text: string, onEnd?: () => void) {
  if (!canSpeak()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ja-JP";
  const voice = japaneseVoice();
  if (voice) u.voice = voice;
  u.rate = 1;
  if (onEnd) {
    u.onend = onEnd;
    u.onerror = onEnd;
  }
  synth.speak(u);
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}

/**
 * iOS Safari は、ユーザー操作の中で一度 speak しておかないと、その後の自動読み上げが鳴らない。
 * 「読み終えた」を押した瞬間に空の発話を流しておく。
 */
export function primeSpeech() {
  if (!canSpeak()) return;
  const u = new SpeechSynthesisUtterance("");
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

const AUTO_READ_KEY = "marginalia.autoReadQuestion";

/** 「問いを自動で読み上げる」設定。端末ごとの好みなので localStorage に置く(読めなくても動く) */
export function useAutoRead(): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      return localStorage.getItem(AUTO_READ_KEY) === "1";
    } catch {
      return false;
    }
  });
  const update = useCallback((v: boolean) => {
    setValue(v);
    try {
      localStorage.setItem(AUTO_READ_KEY, v ? "1" : "0");
    } catch {
      /* 保存できなくても今回は効く */
    }
  }, []);
  return [value, update];
}

// ---------------------------------------------------------------- 音声入力

interface RecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
interface RecognitionEventLike {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResultLike>;
}
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const canDictate = () => recognitionCtor() !== undefined;

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "マイクの使用が許可されていません。設定で許可するか、キーボードの音声入力を使ってください。",
  "service-not-allowed": "この環境では音声入力が使えません。キーボードの音声入力を使ってください。",
  "no-speech": "声が聞き取れませんでした。もう一度どうぞ。",
  "audio-capture": "マイクが見つかりません。",
  network: "音声認識に接続できませんでした。",
};

/** 認識した文を既存のテキストにつなげる(日本語なので区切りは入れない。英数字同士だけ空白を入れる) */
export function appendTranscript(current: string, addition: string): string {
  const a = addition.trim();
  if (!a) return current;
  if (!current) return a;
  const needsSpace = /[A-Za-z0-9]$/.test(current) && /^[A-Za-z0-9]/.test(a);
  return current + (needsSpace ? " " : "") + a;
}

/**
 * 押して話す → 話し終えると自動で止まり、確定した文を onFinal に渡す。
 * 認識途中の文は interim で返す(画面に薄く出す)。
 */
export function useDictation(onFinal: (text: string) => void) {
  const supported = canDictate();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string>();
  const rec = useRef<RecognitionLike | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || rec.current) return;
    stopSpeaking(); // 読み上げ中ならマイクに入らないよう止める
    setError(undefined);
    setInterim("");
    const r = new Ctor();
    r.lang = "ja-JP";
    r.interimResults = true;
    r.continuous = false; // iOS で continuous は不安定なので、ひと区切りごとに止める
    r.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) finalText += res[0].transcript;
        else interimText += res[0].transcript;
      }
      if (finalText) onFinalRef.current(finalText);
      setInterim(interimText);
    };
    r.onerror = (e) => {
      if (e.error !== "aborted") setError(ERROR_MESSAGES[e.error] ?? "音声入力でエラーが起きました。");
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      setInterim("");
    };
    try {
      r.start();
      rec.current = r;
      setListening(true);
    } catch {
      setError(ERROR_MESSAGES["service-not-allowed"]);
    }
  }, []);

  // 画面を離れたら止める
  useEffect(() => () => rec.current?.abort(), []);

  return { supported, listening, interim, error, start, stop };
}
