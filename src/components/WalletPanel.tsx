import { useState } from "react";
import { connectPhantom } from "../wallet";

type WalletPanelProps = {
  wallet: string | null;
  onWalletConnected: (wallet: string) => void;
  onLog: (line: string) => void;
  connectWallet?: () => Promise<string>;
};

export function WalletPanel({ wallet, onWalletConnected, onLog, connectWallet = connectPhantom }: WalletPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    onLog("wallet rail requesting Phantom signature access");

    try {
      const connectedWallet = await connectWallet();
      onWalletConnected(connectedWallet);
      onLog(`phantom wallet linked ${connectedWallet.slice(0, 4)}...${connectedWallet.slice(-4)}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Phantom connection was cancelled.";
      setError(message);
      onLog("phantom connection closed before wallet link");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <section className="utility-panel wallet-panel" aria-labelledby="wallet-panel-title">
      <div className="panel-header">
        <span className="panel-code">ACCESS-01</span>
        <h2 id="wallet-panel-title">wallet rail</h2>
      </div>
      <p className="panel-copy">Connect Phantom so ForgeKit can prepare the configured token flow and mint receipt.</p>
      <button className="forge-button primary" type="button" onClick={handleConnect} disabled={connecting}>
        Connect Phantom
      </button>
      <div className={wallet ? "status-readout ok" : "status-readout warn"}>
        {wallet ? `wallet linked: ${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "wallet not connected"}
      </div>
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
