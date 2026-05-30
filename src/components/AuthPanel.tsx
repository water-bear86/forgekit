import { useState } from "react";
import { signInWithGithub, signInWithGoogle } from "../firebase";

export type SignedInIdentity = {
  uid: string;
  idToken: string;
  provider: "google" | "github";
};

type AuthPanelProps = {
  onLog: (line: string) => void;
  onGoogleSignIn?: () => Promise<unknown>;
  onGithubSignIn?: () => Promise<unknown>;
  onSignedIn?: (identity: SignedInIdentity) => void;
};

export function AuthPanel({
  onLog,
  onGoogleSignIn = signInWithGoogle,
  onGithubSignIn = signInWithGithub,
  onSignedIn,
}: AuthPanelProps) {
  const [status, setStatus] = useState("Modifier score unsigned");
  const [busyProvider, setBusyProvider] = useState<"google" | "github" | null>(null);

  async function handleSignIn(provider: "google" | "github", signIn: () => Promise<unknown>) {
    setBusyProvider(provider);
    setStatus(`${provider} sign-in pending`);
    onLog(`${provider} authentication stamp requested`);

    try {
      const result = await signIn();
      const identity = await identityFromCredential(result, provider);
      setStatus(`${provider} sign-in stamped`);
      onSignedIn?.(identity);
      onLog(`${provider} identity linked to modifier adapter`);
    } catch {
      setStatus(`${provider} sign-in skipped`);
      onLog(`${provider} sign-in window escaped`);
    } finally {
      setBusyProvider(null);
    }
  }

  return (
    <section className="utility-panel auth-panel" aria-labelledby="auth-panel-title">
      <div className="panel-header">
        <span className="panel-code">AUTH-13</span>
        <h2 id="auth-panel-title">modifier adapter</h2>
      </div>
      <p className="panel-copy">Shared Firebase sign-in can attach a project-specific score. Public mints stay baseline.</p>
      <div className="button-stack">
        <button
          className="forge-button"
          type="button"
          disabled={busyProvider !== null}
          onClick={() => void handleSignIn("google", onGoogleSignIn)}
        >
          Sign in with Google
        </button>
        <button
          className="forge-button"
          type="button"
          disabled={busyProvider !== null}
          onClick={() => void handleSignIn("github", onGithubSignIn)}
        >
          Sign in with GitHub
        </button>
      </div>
      <div className="status-readout">{status}</div>
    </section>
  );
}

async function identityFromCredential(result: unknown, provider: "google" | "github"): Promise<SignedInIdentity> {
  const user = (result as { user?: { uid?: unknown; getIdToken?: unknown } } | null)?.user;
  if (!user || typeof user.uid !== "string" || typeof user.getIdToken !== "function") {
    throw new Error("Firebase sign-in did not return a usable user.");
  }

  const idToken = await user.getIdToken();
  if (typeof idToken !== "string" || !idToken.trim()) {
    throw new Error("Firebase sign-in did not return an ID token.");
  }

  return { uid: user.uid, idToken, provider };
}
