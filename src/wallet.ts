import type { Transaction } from "@solana/web3.js";

export type PhantomProvider = {
  isPhantom?: boolean;
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  signAndSendTransaction?: (transaction: Transaction) => Promise<{ signature?: string } | string>;
};

declare global {
  interface Window {
    solana?: PhantomProvider;
  }
}

export async function connectPhantom(): Promise<string> {
  const provider = window.solana;

  if (!provider?.isPhantom || typeof provider.connect !== "function") {
    throw new Error("Phantom wallet missing. Install Phantom to bribe the license counter.");
  }

  const response = await provider.connect();
  return response.publicKey.toString();
}
