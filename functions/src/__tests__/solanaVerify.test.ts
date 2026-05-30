import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { fetchParsedFinalizedTransaction, verifyParsedForgeTransaction } from "../solanaVerify.js";

const wallet = "Wallet1111111111111111111111111111111111";
const mint = "DJ15QJxVPFGv6kYhT6LvDGqG9b4aBFWQzavA7dGxpump";
const treasuryWallet = "Treasury111111111111111111111111111111111";
const burnBaseUnits = "14219576720";
const reserveLamports = 2058824;
const signature = "5wM3p8Z8h1qYQBnV8z4tX8YjvM9v2zNt93s8JomKk9SNMRL6mZppAn6YqPnxVqRmxkHoLJk27WvHgcFbU41SKqfH";

describe("fetchParsedFinalizedTransaction", () => {
  it("validates RPC URL and signature before opening a connection", async () => {
    await assert.rejects(() => fetchParsedFinalizedTransaction("", signature), /rpcUrl is required/);
    await assert.rejects(() => fetchParsedFinalizedTransaction("https://rpc.test", " "), /signature is required/);
  });
});

describe("verifyParsedForgeTransaction", () => {
  it("accepts a finalized transaction with the expected Token-2022 burn and reserve transfer", () => {
    const result = verifyParsedForgeTransaction({
      wallet,
      mint,
      treasuryWallet,
      burnBaseUnits,
      reserveLamports,
      transaction: parsedForgeTransaction(),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("accepts parsed burnChecked authority without an owner field", () => {
    const result = verifyParsedForgeTransaction({
      wallet,
      mint,
      treasuryWallet,
      burnBaseUnits,
      reserveLamports,
      transaction: parsedForgeTransaction({ includeOwner: false }),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects owner-only parsed burn info because authority is required", () => {
    const result = verifyParsedForgeTransaction({
      wallet,
      mint,
      treasuryWallet,
      burnBaseUnits,
      reserveLamports,
      transaction: parsedForgeTransaction({ includeAuthority: false }),
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /Token-2022 burn/);
  });

  it("rejects parsed burnChecked authority from a different wallet", () => {
    const result = verifyParsedForgeTransaction({
      wallet,
      mint,
      treasuryWallet,
      burnBaseUnits,
      reserveLamports,
      transaction: parsedForgeTransaction({ authority: "OtherWallet1111111111111111111111111111" }),
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /Token-2022 burn/);
  });

  it("rejects failed transactions", () => {
    const result = verifyParsedForgeTransaction({
      wallet,
      mint,
      treasuryWallet,
      burnBaseUnits,
      reserveLamports,
      transaction: parsedForgeTransaction({ err: { InstructionError: [0, "Custom"] } }),
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /failed on chain/);
  });

  it("rejects transactions when meta err is absent", () => {
    const result = verifyParsedForgeTransaction({
      wallet,
      mint,
      treasuryWallet,
      burnBaseUnits,
      reserveLamports,
      transaction: parsedForgeTransaction({ meta: {} }),
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /failed on chain/);
  });

  it("rejects transactions that were not signed by the wallet", () => {
    const result = verifyParsedForgeTransaction({
      wallet,
      mint,
      treasuryWallet,
      burnBaseUnits,
      reserveLamports,
      transaction: parsedForgeTransaction({ walletSigner: false }),
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /wallet did not sign/);
  });

  it("rejects string account keys because they do not prove the wallet signed", () => {
    const result = verifyParsedForgeTransaction({
      wallet,
      mint,
      treasuryWallet,
      burnBaseUnits,
      reserveLamports,
      transaction: parsedForgeTransaction({ accountKeys: [wallet] }),
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /wallet did not sign/);
  });

  it("rejects burns with the wrong mint, owner, amount, or decimals", () => {
    const result = verifyParsedForgeTransaction({
      wallet,
      mint,
      treasuryWallet,
      burnBaseUnits,
      reserveLamports,
      transaction: parsedForgeTransaction({ burnAmount: "1" }),
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /Token-2022 burn/);
  });

  it("rejects reserve transfers below the quoted lamports", () => {
    const result = verifyParsedForgeTransaction({
      wallet,
      mint,
      treasuryWallet,
      burnBaseUnits,
      reserveLamports,
      transaction: parsedForgeTransaction({ reserveLamports: reserveLamports - 1 }),
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /reserve transfer/);
  });

  it("does not require a reserve transfer when quoted reserve is zero", () => {
    const result = verifyParsedForgeTransaction({
      wallet,
      mint,
      treasuryWallet,
      burnBaseUnits,
      reserveLamports: 0,
      transaction: parsedForgeTransaction({ includeTransfer: false }),
    });

    assert.equal(result.ok, true);
  });

  it("rejects invalid reserve lamports instead of bypassing transfer verification", () => {
    for (const invalidReserve of [-1, Number.NaN]) {
      const result = verifyParsedForgeTransaction({
        wallet,
        mint,
        treasuryWallet,
        burnBaseUnits,
        reserveLamports: invalidReserve,
        transaction: parsedForgeTransaction({ includeTransfer: false }),
      });

      assert.equal(result.ok, false);
      assert.match(result.errors.join("\n"), /reserveLamports/);
    }
  });

  it("rejects burn amounts that are not positive u64 values", () => {
    for (const invalidBurn of ["0", "-1", "18446744073709551616", "wat"]) {
      const result = verifyParsedForgeTransaction({
        wallet,
        mint,
        treasuryWallet,
        burnBaseUnits: invalidBurn,
        reserveLamports,
        transaction: parsedForgeTransaction(),
      });

      assert.equal(result.ok, false);
      assert.match(result.errors.join("\n"), /burnBaseUnits/);
    }
  });
});

function parsedForgeTransaction(
  overrides: {
    err?: unknown;
    walletSigner?: boolean;
    accountKeys?: Array<string | { pubkey: string; signer: boolean }>;
    burnAmount?: string;
    authority?: string;
    includeAuthority?: boolean;
    includeOwner?: boolean;
    reserveLamports?: number;
    includeTransfer?: boolean;
    meta?: { err?: unknown };
  } = {},
) {
  return {
    meta: overrides.meta ?? { err: overrides.err ?? null },
    transaction: {
      message: {
        accountKeys: overrides.accountKeys ?? [{ pubkey: wallet, signer: overrides.walletSigner ?? true }],
        instructions: [
          {
            programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
            parsed: {
              type: "burnChecked",
              info: {
                mint,
                ...(overrides.includeOwner === false ? {} : { owner: wallet }),
                ...(overrides.includeAuthority === false ? {} : { authority: overrides.authority ?? wallet }),
                tokenAmount: { amount: overrides.burnAmount ?? burnBaseUnits, decimals: 6 },
              },
            },
          },
          ...(overrides.includeTransfer === false
            ? []
            : [
                {
                  programId: "11111111111111111111111111111111",
                  parsed: {
                    type: "transfer",
                    info: {
                      source: wallet,
                      destination: treasuryWallet,
                      lamports: overrides.reserveLamports ?? reserveLamports,
                    },
                  },
                },
              ]),
        ],
      },
    },
  };
}
