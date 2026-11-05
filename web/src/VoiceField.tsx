import { appendTranscript, useDictation } from "./speech";

/**
 * マイクボタン付きのテキスト欄。話した内容は欄の末尾に追加され、そのまま手で直せる。
 * 音声認識に対応していないブラウザではふつうのテキスト欄になる。
 */
export function VoiceField(props: {
  value: string;
  onChange: (v: string) => void;
  /** 音声で1回でも文字が入ったら呼ばれる(usedVoice の記録用) */
  onVoiceUsed?: () => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  className?: string;
  label?: string;
}) {
  const { supported, listening, interim, error, start, stop } = useDictation((text) => {
    props.onChange(appendTranscript(props.value, text));
    props.onVoiceUsed?.();
  });

  return (
    <div className="voice-field">
      <div className="voice-input">
        <textarea
          className={props.className}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={listening ? "どうぞ、話してください" : props.placeholder}
          rows={props.rows}
          autoFocus={props.autoFocus}
          aria-label={props.label}
        />
        {supported && (
          <button
            type="button"
            className={`mic ${listening ? "on" : ""}`}
            onClick={listening ? stop : start}
            aria-pressed={listening}
            aria-label={listening ? "音声入力を止める" : "声で入力する"}
          >
            <MicIcon />
          </button>
        )}
      </div>
      {listening && <p className="interim" aria-live="polite">{interim || "聞いています…"}</p>}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}
