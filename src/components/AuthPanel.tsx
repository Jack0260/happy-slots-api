import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function AuthPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function go(kind: "in" | "up") {
    setBusy(true);
    setMsg("");
    const { data, error } =
      kind === "in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin },
          });
    setBusy(false);
    if (error) return setMsg(error.message);
    if (kind === "up" && !data.session) setMsg("Check your inbox to confirm your email, then sign in.");
  }

  return (
    <section className="panel max-w-md">
      <h2 className="panel-title">Sign in</h2>
      <div className="space-y-2">
        <input className="field" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input
          className="field"
          type="password"
          placeholder="password (min 6)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy} onClick={() => go("in")}>Sign in</button>
          <button className="btn-ghost" disabled={busy} onClick={() => go("up")}>Create account</button>
        </div>
        {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      </div>
    </section>
  );
}
