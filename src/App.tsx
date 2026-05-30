import { useCallback, useMemo, useRef, useState } from "react";
import {
  finalizeForge,
  type FinalizedLicense,
  type ForgeOfferId,
  type ForgeQuote,
  isReadyForgeQuote,
  verifyForge,
} from "./api";
import { AuthPanel } from "./components/AuthPanel";
import { ForgeResult, type WorkflowStep } from "./components/ForgeResult";
import { AdminPanel } from "./components/AdminPanel";
import { LicensePreview } from "./components/LicensePreview";
import { ForgeLog } from "./components/ForgeLog";
import { OfferPanel } from "./components/OfferPanel";
import { WalletPanel } from "./components/WalletPanel";
import { submitForgeBurn, type SubmitForgeBurnInput } from "./forgeWorkflow";
import type { SignedInIdentity } from "./components/AuthPanel";
import { forgeProjectConfig } from "../shared/config";

const BASE_LOGS = [
  "syncing ForgeKit slot rail",
  "Solana slot sampler warming",
  "waiting on Phantom wallet",
  "project pack resolver idle",
];

export interface AppProps {
  admin?: boolean;
  adminIdToken?: string;
  submitBurn?: (input: SubmitForgeBurnInput) => Promise<string>;
  verifyRequest?: typeof verifyForge;
  finalizeRequest?: typeof finalizeForge;
}

export function App({
  admin = false,
  adminIdToken,
  submitBurn = submitForgeBurn,
  verifyRequest = verifyForge,
  finalizeRequest = finalizeForge,
}: AppProps = {}) {
  const [wallet, setWallet] = useState<string | null>(null);
  const [identity, setIdentity] = useState<SignedInIdentity | null>(null);
  const [offerId, setOfferId] = useState<ForgeOfferId>("standard");
  const [quote, setQuote] = useState<ForgeQuote | null>(null);
  const [logs, setLogs] = useState(BASE_LOGS);
  const [forging, setForging] = useState(false);
  const [receipt, setReceipt] = useState<FinalizedLicense | null>(null);
  const [forgeError, setForgeError] = useState<string | null>(null);
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>("phantom");
  const forgeRequestId = useRef(0);
  const project = useMemo(() => forgeProjectConfig(), []);

  const addLog = useCallback((line: string) => {
    setLogs((currentLogs) => [...currentLogs.slice(-6), line]);
  }, []);

  const handleOfferSelected = useCallback((selectedOfferId: ForgeOfferId) => {
    setOfferId(selectedOfferId);
    setReceipt(null);
    setForgeError(null);
  }, []);

  const handleQuoteReady = useCallback((nextQuote: ForgeQuote | null) => {
    setQuote(nextQuote);
    setReceipt(null);
    setForgeError(null);
    if (isReadyForgeQuote(nextQuote)) setWorkflowStep("quote");
  }, []);

  const handleWalletConnected = useCallback((connectedWallet: string) => {
    setWallet(connectedWallet);
    setReceipt(null);
    setForgeError(null);
    setWorkflowStep("modifier");
  }, []);

  const handleSignedIn = useCallback(
    (nextIdentity: SignedInIdentity) => {
      setIdentity(nextIdentity);
      if (wallet && !isReadyForgeQuote(quote)) setWorkflowStep("quote");
    },
    [quote, wallet],
  );

  const readyState = useMemo(() => Boolean(wallet && isReadyForgeQuote(quote) && !forging), [forging, quote, wallet]);

  async function handleForge() {
    if (!readyState || !wallet || !isReadyForgeQuote(quote)) {
      addLog("forge button denied: backend quote missing");
      return;
    }

    setForging(true);
    setReceipt(null);
    setForgeError(null);
    setWorkflowStep("burn");
    const requestId = forgeRequestId.current + 1;
    forgeRequestId.current = requestId;
    addLog(`Phantom burn window opening for ${project.token.symbol} Token-2022 transaction`);

    try {
      const signature = await submitBurn({ wallet, quote });
      if (forgeRequestId.current !== requestId) return;
      setWorkflowStep("verify");
      addLog(`chain signature ${signature.slice(0, 6)}...${signature.slice(-4)} sent to verifier`);

      const verified = await verifyRequest({ wallet, quoteId: quote.quoteId, signature }, identity?.idToken);
      if (forgeRequestId.current !== requestId) return;
      const verifiedRequestId = verified.requestId ?? verified.id ?? verified.signature ?? signature;
      setWorkflowStep("finalize");
      addLog("verified token flow accepted; compositor and Core mint waking up");

      const license = await finalizeRequest({ requestId: verifiedRequestId }, identity?.idToken);
      if (forgeRequestId.current !== requestId) return;
      setWorkflowStep("receipt");
      setReceipt(license);
      addLog(`asset receipt minted ${license.licenseId.slice(0, 6)}...${license.licenseId.slice(-4)}`);
    } catch (err) {
      if (forgeRequestId.current !== requestId) return;
      const message = err instanceof Error ? err.message : "forge workflow failed";
      setForgeError(message);
      addLog(`forge rejected: ${message}`);
    } finally {
      if (forgeRequestId.current !== requestId) return;
      setForging(false);
    }
  }

  return (
    <main className="forge-shell">
      <section className="forge-board" aria-label="ForgeKit procedural NFT engine">
        <header className="forge-titlebar">
          <div>
            <p className="stamp">{project.brand.issuerName}</p>
            <h1>{project.brand.engineName}</h1>
            <p className="subtitle-line">{project.brand.tagline}</p>
          </div>
          <p className="notice">SOLANA LIVE</p>
        </header>

        <div className="slot-rail" aria-hidden="true" />

        <div className="forge-grid">
          <div className="left-stack">
            <WalletPanel wallet={wallet} onWalletConnected={handleWalletConnected} onLog={addLog} />
            <AuthPanel onLog={addLog} onSignedIn={handleSignedIn} />
            <OfferPanel
              wallet={wallet}
              locked={forging}
              idToken={identity?.idToken}
              onQuoteReady={handleQuoteReady}
              onOfferSelected={handleOfferSelected}
              onLog={addLog}
            />
          </div>

          <LicensePreview wallet={wallet} offerId={offerId} quote={quote} modifierLinked={Boolean(identity)} />

          <ForgeLog lines={logs} />
        </div>

        <ForgeResult
          wallet={wallet}
          quote={quote}
          modifierLinked={Boolean(identity)}
          forging={forging}
          receipt={receipt}
          error={forgeError}
          workflowStep={workflowStep}
          onForge={() => void handleForge()}
        />
        <AdminPanel admin={admin} idToken={adminIdToken} />
      </section>
    </main>
  );
}
