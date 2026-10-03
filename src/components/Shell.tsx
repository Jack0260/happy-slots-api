import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";

export function Shell({ children }: { children: ReactNode }) {
  const { session } = useSession();
  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-5 py-3 text-sm">
          <span className="font-semibold text-primary">booking.api</span>
          <Link to="/" className="nav-link" activeProps={{ className: "nav-link-active" }} activeOptions={{ exact: true }}>
            test ui
          </Link>
          <Link to="/dashboard" className="nav-link" activeProps={{ className: "nav-link-active" }}>
            dashboard
          </Link>
          <a href="/api/public/metrics" className="nav-link" target="_blank" rel="noreferrer">/metrics</a>
          {session && (
            <button className="nav-link ml-auto" onClick={() => supabase.auth.signOut()}>
              sign out · {session.user.email}
            </button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>
    </div>
  );
}
