import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { forgeTokenConfig, publicSolanaRpcUrl } from "../shared/config";
import { buildForgeTransaction } from "../shared/solanaForge";
import type { ReadyForgeQuote } from "./api";
import type { PhantomProvider } from "./wallet";

export type SubmitForgeBurnInput = {
  wallet: string;
  quote: ReadyForgeQuote;
  provider?: PhantomProvider;
  rpcUrl?: string;
};

export async function submitForgeBurn(input: SubmitForgeBurnInput): Promise<string> {
  const provider = input.provider ?? window.solana;
  if (!provider?.signAndSendTransaction) {
    throw new Error("Phantom burn window is unavailable. Connect a wallet that can sign transactions.");
  }

  const rpcUrl = input.rpcUrl ?? publicSolanaRpcUrl();
  const tokenConfig = forgeTokenConfig();
  const connection = new Connection(rpcUrl, "confirmed");
  const wallet = new PublicKey(input.wallet);
  const mint = new PublicKey(tokenConfig.mint);
  const treasury = new PublicKey(input.quote.treasuryWallet);
  const tokenProgramId = new PublicKey(tokenConfig.tokenProgramId);
  const tokenAccount = getAssociatedTokenAddressSync(mint, wallet, false, tokenProgramId);
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = buildForgeTransaction({
    wallet,
    tokenAccount,
    mint,
    treasury,
    tokenProgramId,
    tokenDecimals: tokenConfig.decimals,
    burnBaseUnits: input.quote.burnBaseUnits,
    reserveLamports: input.quote.reserveLamports,
    latestBlockhash: latestBlockhash.blockhash,
  });

  const result = await provider.signAndSendTransaction(transaction);
  const signature = typeof result === "string" ? result : result.signature;
  if (!signature) throw new Error("Phantom returned no burn signature.");

  await connection
    .confirmTransaction(
      {
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      "confirmed",
    )
    .catch(() => undefined);

  return signature;
}
