import { createBurnCheckedInstruction, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

const U64_MAX = 18446744073709551615n;

export interface BuildForgeTransactionInput {
  wallet: PublicKey;
  tokenAccount: PublicKey;
  mint: PublicKey;
  treasury: PublicKey;
  tokenProgramId?: PublicKey;
  burnBaseUnits: string;
  reserveLamports: number;
  tokenDecimals: number;
  latestBlockhash: string;
}

export function buildForgeTransaction(input: BuildForgeTransactionInput): Transaction {
  const burnAmount = parsePositiveU64(input.burnBaseUnits, "burnBaseUnits");
  if (!Number.isSafeInteger(input.reserveLamports) || input.reserveLamports < 0) {
    throw new Error("reserveLamports must be a safe non-negative integer");
  }
  if (!Number.isSafeInteger(input.tokenDecimals) || input.tokenDecimals < 0 || input.tokenDecimals > 18) {
    throw new Error("tokenDecimals must be a safe integer between 0 and 18");
  }

  const tx = new Transaction({
    feePayer: input.wallet,
    recentBlockhash: input.latestBlockhash,
  });

  tx.add(
    createBurnCheckedInstruction(
      input.tokenAccount,
      input.mint,
      input.wallet,
      burnAmount,
      input.tokenDecimals,
      [],
      input.tokenProgramId ?? TOKEN_2022_PROGRAM_ID,
    ),
  );

  if (input.reserveLamports > 0) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: input.wallet,
        toPubkey: input.treasury,
        lamports: input.reserveLamports,
      }),
    );
  }

  return tx;
}

function parsePositiveU64(value: string, fieldName: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(`${fieldName} must be a positive u64`);
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > U64_MAX) throw new Error(`${fieldName} must be a positive u64`);
  return parsed;
}
