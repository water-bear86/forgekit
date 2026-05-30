/* @vitest-environment node */

import { decodeBurnCheckedInstruction, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, SystemInstruction, SystemProgram } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { buildForgeTransaction } from "../../shared/solanaForge";

describe("buildForgeTransaction", () => {
  it("adds Token-2022 burn and SOL reserve transfer instructions", () => {
    const wallet = new PublicKey("11111111111111111111111111111112");
    const tokenAccount = new PublicKey("11111111111111111111111111111113");
    const treasury = new PublicKey("11111111111111111111111111111114");
    const mint = new PublicKey("DJ15QJxVPFGv6kYhT6LvDGqG9b4aBFWQzavA7dGxpump");

    const tx = buildForgeTransaction({
      wallet,
      tokenAccount,
      mint,
      treasury,
      burnBaseUnits: "14219576720",
      reserveLamports: 2058824,
      tokenDecimals: 6,
      latestBlockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k",
    });

    expect(tx.feePayer?.toBase58()).toBe(wallet.toBase58());
    expect(tx.instructions).toHaveLength(2);

    const burn = decodeBurnCheckedInstruction(tx.instructions[0], TOKEN_2022_PROGRAM_ID);
    expect(burn.keys.account.pubkey.toBase58()).toBe(tokenAccount.toBase58());
    expect(burn.keys.account.isWritable).toBe(true);
    expect(burn.keys.mint.pubkey.toBase58()).toBe(mint.toBase58());
    expect(burn.keys.mint.isWritable).toBe(true);
    expect(burn.keys.owner.pubkey.toBase58()).toBe(wallet.toBase58());
    expect(burn.keys.owner.isSigner).toBe(true);
    expect(burn.data.amount).toBe(14219576720n);
    expect(burn.data.decimals).toBe(6);

    expect(SystemInstruction.decodeInstructionType(tx.instructions[1])).toBe("Transfer");
    const transfer = SystemInstruction.decodeTransfer(tx.instructions[1]);
    expect(tx.instructions[1].programId.toBase58()).toBe(SystemProgram.programId.toBase58());
    expect(transfer.fromPubkey.toBase58()).toBe(wallet.toBase58());
    expect(transfer.toPubkey.toBase58()).toBe(treasury.toBase58());
    expect(transfer.lamports).toBe(2058824n);
  });

  it("omits the SOL reserve transfer when reserve lamports are zero", () => {
    const wallet = new PublicKey("11111111111111111111111111111112");
    const tokenAccount = new PublicKey("11111111111111111111111111111113");
    const treasury = new PublicKey("11111111111111111111111111111114");
    const mint = new PublicKey("DJ15QJxVPFGv6kYhT6LvDGqG9b4aBFWQzavA7dGxpump");

    const tx = buildForgeTransaction({
      wallet,
      tokenAccount,
      mint,
      treasury,
      burnBaseUnits: "14219576720",
      reserveLamports: 0,
      tokenDecimals: 6,
      latestBlockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k",
    });

    expect(tx.instructions).toHaveLength(1);
    expect(decodeBurnCheckedInstruction(tx.instructions[0], TOKEN_2022_PROGRAM_ID).data.amount).toBe(14219576720n);
  });

  it("rejects burns larger than a u64 before building instructions", () => {
    expect(() => buildTestTransaction({ burnBaseUnits: "18446744073709551616", reserveLamports: 0 })).toThrow(
      /positive u64/,
    );
  });

  it("rejects zero and non-digit burn amounts", () => {
    expect(() => buildTestTransaction({ burnBaseUnits: "0", reserveLamports: 0 })).toThrow(/positive u64/);
    expect(() => buildTestTransaction({ burnBaseUnits: "not-digits", reserveLamports: 0 })).toThrow(/positive u64/);
  });

  it("uses configured token decimals in burn checked instructions", () => {
    const tx = buildTestTransaction({ burnBaseUnits: "800", reserveLamports: 0, tokenDecimals: 2 });

    const burn = decodeBurnCheckedInstruction(tx.instructions[0], TOKEN_2022_PROGRAM_ID);
    expect(burn.data.decimals).toBe(2);
  });

  it("rejects invalid reserve lamports", () => {
    for (const reserveLamports of [-1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => buildTestTransaction({ burnBaseUnits: "14219576720", reserveLamports })).toThrow(
        /reserveLamports/,
      );
    }
  });
});

function buildTestTransaction(overrides: { burnBaseUnits: string; reserveLamports: number; tokenDecimals?: number }) {
  return buildForgeTransaction({
    wallet: new PublicKey("11111111111111111111111111111112"),
    tokenAccount: new PublicKey("11111111111111111111111111111113"),
    mint: new PublicKey("DJ15QJxVPFGv6kYhT6LvDGqG9b4aBFWQzavA7dGxpump"),
    treasury: new PublicKey("11111111111111111111111111111114"),
    tokenDecimals: 6,
    latestBlockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k",
    ...overrides,
  });
}
