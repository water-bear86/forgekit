import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";

describe("ForgeKit public app", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "solana");
  });

  it("renders the ForgeKit procedural NFT workflow immediately", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "ForgeKit" })).toBeInTheDocument();
    expect(screen.getAllByText(/project pack/i).length).toBeGreaterThan(0);
    expect(screen.getByText("ForgeKit Procedure Lab")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Phantom" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Standard Forge" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Boosted Forge" })).toBeInTheDocument();
    expect(screen.getByText("SOLANA LIVE")).toBeInTheDocument();
    expect(screen.getByText("forgekit logs")).toBeInTheDocument();
    expect(screen.queryByText("Goblintown Driver's License Forge")).not.toBeInTheDocument();
  });

  it("keeps Forge NFT disabled until wallet and quote are ready", () => {
    render(<App />);

    const forgeButton = screen.getByRole("button", { name: "Forge NFT" });
    expect(forgeButton).toBeDisabled();
    expect(screen.getByText(/connect Phantom and fetch a backend quote/i)).toBeInTheDocument();
  });

  it("connects Phantom, loads a backend quote, and enables the burn flow", async () => {
    window.solana = {
      isPhantom: true,
      connect: vi.fn().mockResolvedValue({
        publicKey: { toString: () => "GOBL1nTown111111111111111111111111111111111" },
      }),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          offerId: "standard",
          label: "Standard Forge",
          usdTarget: "~$2.50 target",
          burnAmount: 1000000,
          quoteId: "quote-standard",
          burnBaseUnits: "14219576720",
          reserveLamports: 2058824,
          treasuryWallet: "Treasury111111111111111111111111111111111",
          expiresAt: "2026-05-27T22:00:00.000Z",
        }),
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Connect Phantom" }));

    await waitFor(() => expect(screen.getByText("Standard Forge: ~$2.50 target")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Forge NFT" })).toBeEnabled();
  });

  it("keeps simulated quotes from unlocking the burn flow", async () => {
    window.solana = {
      isPhantom: true,
      connect: vi.fn().mockResolvedValue({
        publicKey: { toString: () => "GOBL1nTown111111111111111111111111111111111" },
      }),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: "offline" }),
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Connect Phantom" }));

    await waitFor(() => expect(screen.getAllByText(/preview only/i).length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: "Forge NFT" })).toBeDisabled();
  });

  it("locks offer switching while burn, verify, finalize, and receipt resolve", async () => {
    window.solana = {
      isPhantom: true,
      connect: vi.fn().mockResolvedValue({
        publicKey: { toString: () => "GOBL1nTown111111111111111111111111111111111" },
      }),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          offerId: "standard",
          label: "Standard Forge",
          targetUsd: 2.5,
          burnUiAmount: 1000000,
          quoteId: "quote-standard",
          burnBaseUnits: "14219576720",
          reserveLamports: 2058824,
          treasuryWallet: "Treasury111111111111111111111111111111111",
          expiresAt: Date.parse("2026-05-27T22:00:00.000Z"),
        }),
      }),
    );
    let resolveBurn!: (signature: string) => void;
    const submitBurn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveBurn = resolve;
        }),
    );
    const verifyRequest = vi.fn().mockResolvedValue({ id: "sig-standard", status: "verified" });
    const finalizeRequest = vi.fn().mockResolvedValue({
      licenseId: "license-standard",
      assetAddress: "asset-standard",
      rarityScore: 1000,
      loot: 0,
      lootBoost: 0,
    });

    render(<App submitBurn={submitBurn} verifyRequest={verifyRequest} finalizeRequest={finalizeRequest} />);

    fireEvent.click(screen.getByRole("button", { name: "Connect Phantom" }));
    await waitFor(() => expect(screen.getByText("Standard Forge: ~$2.50 target")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Forge NFT" }));
    const degenOffer = screen.getByRole("button", { name: "Boosted Forge" });

    expect(degenOffer).toBeDisabled();
    fireEvent.click(degenOffer);

    await act(async () => {
      resolveBurn("sig-standard");
    });

    expect(screen.getByText("Standard Forge: ~$2.50 target")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/receipt issued/i)).toBeInTheDocument());
    expect(verifyRequest).toHaveBeenCalledWith(
      { wallet: "GOBL1nTown111111111111111111111111111111111", quoteId: "quote-standard", signature: "sig-standard" },
      undefined,
    );
    expect(finalizeRequest).toHaveBeenCalledWith({ requestId: "sig-standard" }, undefined);
    expect(screen.queryByText(/license forged/i)).not.toBeInTheDocument();
  });
});
