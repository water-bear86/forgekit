import { useState } from "react";
import { apiPost } from "../api";

type AdminPanelProps = {
  admin?: boolean;
  idToken?: string;
};

type AdminResponse = {
  ok: true;
  adminUid: string;
  requestId?: string;
};

const STARTER_TRAIT_MANIFEST = JSON.stringify(
  {
    id: "active",
    version: 1,
    categories: ["background"],
    traits: [],
  },
  null,
  2,
);

export function AdminPanel({ admin = false, idToken }: AdminPanelProps) {
  const [targetUsd, setTargetUsd] = useState(2.5);
  const [opsReserveUsd, setOpsReserveUsd] = useState(0.35);
  const [wallet, setWallet] = useState("");
  const [traitManifest, setTraitManifest] = useState(STARTER_TRAIT_MANIFEST);
  const [status, setStatus] = useState("operator panel sealed");
  const [busy, setBusy] = useState(false);

  if (!admin) return null;

  async function saveOffer() {
    setBusy(true);
    setStatus("saving offer config");
    try {
      const response = await apiPost<AdminResponse, {
        offerId: string;
        patch: {
          targetUsd: number;
          opsReserveUsd: number;
          royaltyBasisPoints: number;
        };
      }>(
        "/api/admin/offers",
        {
          offerId: "standard",
          patch: {
            targetUsd,
            opsReserveUsd,
            royaltyBasisPoints: 500,
          },
        },
        { idToken },
      );
      setStatus(`offer config saved by ${response.adminUid}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "offer config rejected");
    } finally {
      setBusy(false);
    }
  }

  async function saveTraits() {
    setBusy(true);
    setStatus("validating trait pack manifest");
    try {
      const response = await apiPost<AdminResponse, { manifest: string }>(
        "/api/admin/traits",
        { manifest: traitManifest },
        { idToken },
      );
      setStatus(`trait pack filed by ${response.adminUid}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "trait pack rejected");
    } finally {
      setBusy(false);
    }
  }

  async function adminMint() {
    setBusy(true);
    setStatus("opening operator mint path");
    try {
      const response = await apiPost<AdminResponse, { wallet: string; offerId: string }>(
        "/api/admin/mint",
        { wallet, offerId: "standard" },
        { idToken },
      );
      setStatus(`operator mint ${response.requestId ?? "queued"} filed by ${response.adminUid}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "admin mint rejected");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="admin-panel" aria-label="ForgeKit operator panel">
      <div className="panel-header">
        <div>
          <p className="panel-code">operator vault</p>
          <h2>Secure Operator Panel</h2>
        </div>
        <span className="admin-sigil">STAFF</span>
      </div>

      <div className="admin-grid">
        <label className="admin-field">
          <span>Target USD</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={targetUsd}
            onChange={(event) => setTargetUsd(event.currentTarget.valueAsNumber)}
          />
        </label>
        <label className="admin-field">
          <span>Ops Reserve USD</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={opsReserveUsd}
            onChange={(event) => setOpsReserveUsd(event.currentTarget.valueAsNumber)}
          />
        </label>
      </div>

      <label className="admin-field">
        <span>Operator Mint Wallet</span>
        <input value={wallet} onChange={(event) => setWallet(event.currentTarget.value)} />
      </label>

      <label className="admin-field">
        <span>Trait Pack Manifest</span>
        <textarea
          rows={7}
          value={traitManifest}
          onChange={(event) => setTraitManifest(event.currentTarget.value)}
        />
      </label>

      <div className="admin-actions">
        <button className="forge-button primary" type="button" disabled={busy} onClick={saveOffer}>
          Save Offer
        </button>
        <button className="forge-button" type="button" disabled={busy} onClick={saveTraits}>
          Save Traits
        </button>
        <button className="forge-button" type="button" disabled={busy || !wallet.trim()} onClick={adminMint}>
          Operator Mint
        </button>
      </div>

      <p className="status-readout ok" aria-live="polite">{status}</p>
    </aside>
  );
}
