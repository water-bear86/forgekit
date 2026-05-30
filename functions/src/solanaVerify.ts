import { Connection, type ParsedTransactionWithMeta } from "@solana/web3.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const U64_MAX = 18446744073709551615n;

export interface VerifyParsedInput {
  wallet: string;
  mint: string;
  tokenDecimals?: number;
  treasuryWallet: string;
  burnBaseUnits: string;
  reserveLamports: number;
  transaction: {
    meta?: { err?: unknown } | null;
    transaction?: {
      message?: {
        accountKeys?: Array<string | { pubkey?: StringLike; signer?: boolean }>;
        instructions?: ParsedInstruction[];
      };
    };
  };
}

export interface VerifyParsedResult {
  ok: boolean;
  errors: string[];
}

interface ParsedInstruction {
  programId?: StringLike;
  parsed?: {
    type?: string;
    info?: Record<string, unknown>;
  };
}

type StringLike = string | { toString(): string };

export async function fetchParsedFinalizedTransaction(
  rpcUrl: string,
  signature: string,
): Promise<ParsedTransactionWithMeta> {
  const normalizedRpcUrl = rpcUrl.trim();
  const normalizedSignature = signature.trim();
  if (!normalizedRpcUrl) throw new Error("rpcUrl is required");
  if (!normalizedSignature) throw new Error("signature is required");

  const connection = new Connection(normalizedRpcUrl);
  const transaction = await connection.getParsedTransaction(normalizedSignature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (!transaction) throw new Error(`Finalized transaction ${normalizedSignature} was not found.`);
  return transaction;
}

export function verifyParsedForgeTransaction(input: VerifyParsedInput): VerifyParsedResult {
  const errors: string[] = [];
  const message = input.transaction.transaction?.message;
  const expectedBurnAmount = parsePositiveU64(input.burnBaseUnits);
  const reserveLamportsValid = Number.isSafeInteger(input.reserveLamports) && input.reserveLamports >= 0;
  const expectedTokenDecimals = input.tokenDecimals ?? 6;
  const tokenDecimalsValid =
    Number.isSafeInteger(expectedTokenDecimals) && expectedTokenDecimals >= 0 && expectedTokenDecimals <= 18;

  if (!expectedBurnAmount) errors.push("burnBaseUnits must be a positive u64");
  if (!reserveLamportsValid) errors.push("reserveLamports must be a safe non-negative integer");
  if (!tokenDecimalsValid) errors.push("tokenDecimals must be a safe integer between 0 and 18");

  if (input.transaction.meta?.err !== null) {
    errors.push("transaction failed on chain");
  }

  const walletSigned = (message?.accountKeys ?? []).some((key) => {
    return typeof key === "object" && stringValue(key.pubkey) === input.wallet && key.signer === true;
  });
  if (!walletSigned) errors.push("wallet did not sign transaction");

  const instructions = message?.instructions ?? [];
  if (
    !expectedBurnAmount ||
    !tokenDecimalsValid ||
    !instructions.some((instruction) => isExpectedBurn(instruction, input, expectedBurnAmount))
  ) {
    errors.push("expected Token-2022 burn was not found");
  }

  if (
    (!reserveLamportsValid || input.reserveLamports > 0) &&
    !instructions.some((instruction) => isExpectedReserveTransfer(instruction, input))
  ) {
    errors.push("expected ops reserve transfer was not found");
  }

  return { ok: errors.length === 0, errors };
}

function isExpectedBurn(instruction: ParsedInstruction, input: VerifyParsedInput, expectedBurnAmount: bigint): boolean {
  const info = instruction.parsed?.info ?? {};
  const tokenAmount = info.tokenAmount as { amount?: unknown; decimals?: unknown } | undefined;
  const amount = typeof info.amount === "string" ? info.amount : tokenAmount?.amount;
  const decimals = typeof info.decimals === "number" ? info.decimals : tokenAmount?.decimals;
  const authority = typeof info.authority === "string" ? info.authority : undefined;

  return (
    stringValue(instruction.programId) === TOKEN_2022_PROGRAM &&
    instruction.parsed?.type === "burnChecked" &&
    info.mint === input.mint &&
    authority === input.wallet &&
    amount === expectedBurnAmount.toString() &&
    decimals === (input.tokenDecimals ?? 6)
  );
}

function isExpectedReserveTransfer(instruction: ParsedInstruction, input: VerifyParsedInput): boolean {
  const info = instruction.parsed?.info ?? {};
  const lamports = typeof info.lamports === "number" ? info.lamports : Number(info.lamports);

  return (
    stringValue(instruction.programId) === SYSTEM_PROGRAM &&
    instruction.parsed?.type === "transfer" &&
    info.source === input.wallet &&
    info.destination === input.treasuryWallet &&
    Number.isFinite(lamports) &&
    lamports >= input.reserveLamports
  );
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof (value as { toString?: unknown }).toString === "function") return String(value);
  return undefined;
}

function parsePositiveU64(value: string): bigint | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > U64_MAX) return undefined;
  return parsed;
}
