import { useLogin } from "@refinedev/core";
import { KeyRound, LogIn } from "lucide-react";
import { FormEvent, useState } from "react";
import { apiRequest } from "../api";

type AuthScreenProps = {
  bootstrap: boolean;
  onBootstrap: () => void;
};

export function AuthScreen({ bootstrap, onBootstrap }: AuthScreenProps) {
  const login = useLogin<{ password: string }>();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (bootstrap) {
        await apiRequest("/api/admin/bootstrap", {
          method: "POST",
          body: JSON.stringify({ password }),
        });
        onBootstrap();
      }
      const result = await login.mutateAsync({ password });
      if (!result.success) throw result.error || new Error("登录失败");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-panel">
        <div className="auth-mark" aria-hidden="true"><KeyRound size={20} /></div>
        <div>
          <div className="eyebrow">Forart Server</div>
          <h1>{bootstrap ? "创建管理员" : "管理员登录"}</h1>
        </div>
        <form className="form-stack" onSubmit={submit}>
          <label className="field">
            <span>密码</span>
            <input autoComplete={bootstrap ? "new-password" : "current-password"} minLength={8} required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error ? <div className="inline-error" role="alert">{error}</div> : null}
          <button className="button button--primary" disabled={busy} type="submit">
            <LogIn size={15} />
            {busy ? "处理中" : bootstrap ? "创建并登录" : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}
