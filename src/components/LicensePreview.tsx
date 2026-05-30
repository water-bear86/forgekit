import type { ForgeOfferId, ForgeQuote } from "../api";
import { forgeProjectConfig } from "../../shared/config";

type LicensePreviewProps = {
  wallet: string | null;
  offerId: ForgeOfferId;
  quote: ForgeQuote | null;
  modifierLinked: boolean;
};

export function LicensePreview({ wallet, offerId, quote, modifierLinked }: LicensePreviewProps) {
  const project = forgeProjectConfig();

  return (
    <section className="license-preview" aria-labelledby="license-preview-title">
      <div className="license-topline">
        <span>{project.brand.projectPackLabel}</span>
        <strong>PROJECT PACK</strong>
      </div>
      <div className="license-card">
        <div className="portrait-box" aria-label="procedural artifact preview area">
          <div className="artifact-core">
            <span className="core-ring outer" />
            <span className="core-ring inner" />
            <span className="core-chip left" />
            <span className="core-chip right" />
          </div>
          <span className="mugshot-label">SEED-PREVIEW</span>
        </div>
        <div className="license-fields">
          <h2 id="license-preview-title">procedural nft preview</h2>
          <dl>
            <div>
              <dt>Offer</dt>
              <dd>{offerId === "degen" ? "Boosted Forge" : "Standard Forge"}</dd>
            </div>
            <div>
              <dt>Wallet</dt>
              <dd>{wallet ? `${wallet.slice(0, 8)}...${wallet.slice(-5)}` : "phantom pending"}</dd>
            </div>
            <div>
              <dt>Rarity</dt>
              <dd>{offerId === "degen" ? "boosted roll after token flow" : "rolled after verified token flow"}</dd>
            </div>
            <div>
              <dt>Modifier</dt>
              <dd>{modifierLinked ? "score adapter linked" : "baseline public odds"}</dd>
            </div>
            <div>
              <dt>Quote</dt>
              <dd>{quote?.usdTarget ?? "awaiting tariff"}</dd>
            </div>
          </dl>
        </div>
        <div className="license-stamp">MINTABLE</div>
      </div>
    </section>
  );
}
