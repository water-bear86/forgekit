import type { FinalizedLicense, ForgeQuote } from "../api";

type ForgeResultProps = {
  wallet: string | null;
  quote: ForgeQuote | null;
  modifierLinked: boolean;
  forging: boolean;
  receipt: FinalizedLicense | null;
  error: string | null;
  workflowStep: WorkflowStep;
  onForge: () => void;
};

export type WorkflowStep = "phantom" | "modifier" | "quote" | "burn" | "verify" | "finalize" | "receipt";

export function ForgeResult({
  wallet,
  quote,
  modifierLinked,
  forging,
  receipt,
  error,
  workflowStep,
  onForge,
}: ForgeResultProps) {
  const ready = Boolean(
    wallet &&
      quote?.quoteId &&
      quote.burnBaseUnits &&
      quote.reserveLamports !== undefined &&
      Number.isSafeInteger(quote.reserveLamports) &&
      quote.reserveLamports >= 0 &&
      quote.treasuryWallet &&
      !forging,
  );
  const stateText = receipt
    ? `receipt issued: ${short(receipt.assetAddress ?? receipt.licenseId)}`
    : error
      ? `rejected: ${error}`
      : forging
        ? workflowStatus(workflowStep)
      : ready
        ? "ready: backend quote locked, chain flow unlit"
        : "disabled: connect Phantom and fetch a backend quote";
  const railItems = [
    { label: "wallet", active: Boolean(wallet), current: !wallet },
    { label: "modifier", active: modifierLinked, current: Boolean(wallet && !modifierLinked && !quote) },
    { label: "quote", active: Boolean(quote?.quoteId), current: workflowStep === "quote" },
    { label: "burn", active: isAfter("burn", workflowStep, receipt), current: workflowStep === "burn" },
    { label: "verify", active: isAfter("verify", workflowStep, receipt), current: workflowStep === "verify" },
    { label: "finalize", active: isAfter("finalize", workflowStep, receipt), current: workflowStep === "finalize" },
    { label: "receipt", active: Boolean(receipt), current: workflowStep === "receipt" },
  ];

  return (
    <section className={ready ? "result-strip ready" : "result-strip"} aria-label="Forge result">
      <div>
        <span className="result-label">engine state</span>
        <strong>{stateText}</strong>
        <ol className="workflow-rail" aria-label="ForgeKit mint workflow">
          {railItems.map((item) => (
            <li
              key={item.label}
              className={item.current ? "current" : item.active ? "complete" : undefined}
              aria-current={item.current ? "step" : undefined}
            >
              {item.label}
            </li>
          ))}
        </ol>
      </div>
      <button className="forge-button cta" type="button" disabled={!ready} onClick={onForge}>
        {forging ? "FORGING NFT..." : "Forge NFT"}
      </button>
    </section>
  );
}

function workflowStatus(step: WorkflowStep): string {
  switch (step) {
    case "burn":
      return "burning: Phantom is signing the Token-2022 flow";
    case "verify":
      return "verifying: chain clerk checks burn and reserve";
    case "finalize":
      return "finalizing: image, metadata, and Core mint in progress";
    case "receipt":
      return "receipt issued";
    default:
      return "waiting: backend quote must verify first";
  }
}

function isAfter(step: WorkflowStep, current: WorkflowStep, receipt: FinalizedLicense | null): boolean {
  if (receipt) return true;
  const order: WorkflowStep[] = ["phantom", "modifier", "quote", "burn", "verify", "finalize", "receipt"];
  return order.indexOf(current) > order.indexOf(step);
}

function short(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}
