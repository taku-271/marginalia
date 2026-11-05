import { useState, type FormEvent } from "react";
import { login, setNewPassword } from "../auth";

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<"login" | "new_password">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPw, setNewPw] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (step === "login") {
        const r = await login(email.trim(), password);
        if (r === "new_password_required") setStep("new_password");
        else onSignedIn();
      } else {
        await setNewPassword(newPw);
        onSignedIn();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page narrow login">
      <h1 className="wordmark">marginalia</h1>
      <p className="tagline">読んだあとに、問いを1つ。</p>
      <form onSubmit={submit} className="stack">
        {step === "login" ? (
          <>
            <label className="field">
              <span>メールアドレス</span>
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="field">
              <span>パスワード</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
          </>
        ) : (
          <label className="field">
            <span>新しいパスワード(12文字以上)</span>
            <input type="password" autoComplete="new-password" minLength={12} value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy}>
          {step === "login" ? "ログイン" : "パスワードを設定"}
        </button>
      </form>
    </main>
  );
}
