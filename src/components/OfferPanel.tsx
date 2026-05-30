import { useEffect, useState } from "react";
import { type ForgeOfferId, type ForgeQuote, requestQuote, simulatedQuote } from "../api";

type OfferPanelProps = {
  wallet: string | null;
  locked: boolean;
  idToken?: string;
  onQuoteReady: (quote: ForgeQuote | null) => void;
  onOfferSelected: (offerId: ForgeOfferId) => void;
  onLog: (line: string) => void;
};

const OFFERS: Array<{ id: ForgeOfferId; label: string; detail: string }> = [
  { id: "standard", label: "Standard Forge", detail: "~$2.50 target, burn/reserve balanced" },
  { id: "degen", label: "Boosted Forge", detail: "~$2.50 target with rare-weight lift" },
];

export function OfferPanel({ wallet, locked, idToken, onQuoteReady, onOfferSelected, onLog }: OfferPanelProps) {
  const [selectedOffer, setSelectedOffer] = useState<ForgeOfferId>("standard");
  const [quote, setQuote] = useState<ForgeQuote | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    onOfferSelected(selectedOffer);
  }, [onOfferSelected, selectedOffer]);

  useEffect(() => {
    let active = true;

    async function loadQuote() {
      if (!wallet) {
        setQuote(null);
        setPreviewText(null);
        onQuoteReady(null);
        return;
      }

      setLoading(true);
      onLog(`quote engine pricing ${selectedOffer}`);

      try {
        const loadedQuote = await requestQuote(wallet, selectedOffer, idToken);
        if (!active) return;
        setQuote(loadedQuote);
        setPreviewText(null);
        onQuoteReady(loadedQuote);
        onLog(`${loadedQuote.label} quote posted at ${loadedQuote.usdTarget}`);
      } catch {
        const fallbackQuote = simulatedQuote(selectedOffer);
        if (!active) return;
        setQuote(null);
        setPreviewText(`${fallbackQuote.label} preview only: ${fallbackQuote.usdTarget}`);
        onQuoteReady(null);
        onLog(`${fallbackQuote.label} preview only; backend quote required`);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadQuote();

    return () => {
      active = false;
    };
  }, [idToken, onLog, onQuoteReady, selectedOffer, wallet]);

  function selectOffer(offerId: ForgeOfferId) {
    if (locked) {
      onLog("offer switch locked while chain workflow stages");
      return;
    }
    setSelectedOffer(offerId);
    setQuote(null);
    setPreviewText(null);
    onQuoteReady(null);
  }

  return (
    <section className="utility-panel offer-panel" aria-labelledby="offer-panel-title">
      <div className="panel-header">
        <span className="panel-code">QUOTE-22</span>
        <h2 id="offer-panel-title">mint quote</h2>
      </div>
      <div className="offer-switch" role="group" aria-label="Forge offer">
        {OFFERS.map((offer) => (
          <button
            key={offer.id}
            className={selectedOffer === offer.id ? "offer-button selected" : "offer-button"}
            type="button"
            disabled={locked}
            onClick={() => selectOffer(offer.id)}
            aria-pressed={selectedOffer === offer.id}
            aria-label={offer.label}
          >
            <span>{offer.label}</span>
            <small>{offer.detail}</small>
          </button>
        ))}
      </div>
      <div className={quote ? "quote-ticket ready" : "quote-ticket"}>
        {locked
          ? "offer locked while mint workflow stages"
          : loading
            ? "fetching live token quote..."
            : quote
              ? `${quote.label}: ${quote.usdTarget}`
              : previewText ?? "connect wallet for ~$2.50 backend quote"}
      </div>
    </section>
  );
}
