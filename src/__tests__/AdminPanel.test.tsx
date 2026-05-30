import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { AdminPanel } from "../components/AdminPanel";

describe("AdminPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders nothing unless admin is true", () => {
    const { container } = render(<AdminPanel admin={false} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Secure Operator Panel")).not.toBeInTheDocument();
  });

  it("renders ForgeKit operator controls for admins", () => {
    render(<AdminPanel admin />);

    expect(screen.getByRole("heading", { name: "Secure Operator Panel" })).toBeInTheDocument();
    expect(screen.getByLabelText("Target USD")).toHaveValue(2.5);
    expect(screen.getByLabelText("Ops Reserve USD")).toHaveValue(0.35);
    expect(screen.getByRole("button", { name: "Save Offer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Operator Mint" })).toBeInTheDocument();
    expect(screen.getByLabelText("Trait Pack Manifest")).toBeInTheDocument();
  });

  it("saves offer patches through the admin endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, adminUid: "admin-1" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminPanel admin idToken="id-token-1" />);

    fireEvent.change(screen.getByLabelText("Target USD"), { target: { value: "4.25" } });
    fireEvent.change(screen.getByLabelText("Ops Reserve USD"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Offer" }));

    await waitFor(() => expect(screen.getByText("offer config saved by admin-1")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/offers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer id-token-1",
      },
      body: JSON.stringify({
        offerId: "standard",
        patch: {
          targetUsd: 4.25,
          opsReserveUsd: 0.5,
          royaltyBasisPoints: 500,
        },
      }),
    });
  });

  it("keeps admin controls hidden in the default app", () => {
    render(<App />);

    expect(screen.queryByText("Secure Operator Panel")).not.toBeInTheDocument();
  });
});
