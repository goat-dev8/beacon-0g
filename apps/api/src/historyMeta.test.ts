import { describe, expect, it } from "vitest";
import { historyMeta } from "./historyMeta.js";

describe("historyMeta", () => {
  it("extracts job ids and capability from desk_link cards", () => {
    const meta = historyMeta({
      lastMessage: "Quote in 0G. Model z-image-turbo.",
      cards: [
        {
          type: "desk_link",
          href: "/flow/desk?job=2b4fa728-54af-4c5e-9266-1fe18e74ba4b",
        },
      ],
    });
    expect(meta.jobIds).toEqual(["2b4fa728-54af-4c5e-9266-1fe18e74ba4b"]);
    expect(meta.capability).toBe("job");
  });

  it("extracts job ids from stay-in-flow job_offer cards", () => {
    const meta = historyMeta({
      lastMessage: "Deep TeeML explanation. Stay in Flow.",
      cards: [
        {
          type: "job_offer",
          jobId: "46339cec-3217-4606-a4ca-cd914c4e58a9",
        },
      ],
    });
    expect(meta.jobIds).toEqual(["46339cec-3217-4606-a4ca-cd914c4e58a9"]);
    expect(meta.capability).toBe("job");
  });

  it("marks reverse swap cards as swap", () => {
    const meta = historyMeta({
      lastMessage: "Live quote 0.001 USDC.e → 0G.",
      cards: [{ type: "swap_prepare", executableFromSafe: false }],
    });
    expect(meta.capability).toBe("swap");
  });
});
