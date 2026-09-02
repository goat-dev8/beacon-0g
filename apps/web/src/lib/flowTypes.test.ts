import { describe, expect, it } from "vitest";
import { cardsForDisplay, type ChatMsg } from "./flowTypes";

describe("cardsForDisplay", () => {
  it("keeps job_offer live on older turns so chatting does not hide a running job", () => {
    const messages: ChatMsg[] = [
      {
        id: "a",
        role: "assistant",
        text: "Quoted.",
        cards: [{ type: "job_offer", title: "Start analysis", jobId: "x" }],
      },
      { id: "b", role: "assistant", text: "Balance inline.", cards: [{ type: "quote", title: "Safe wealth" }] },
    ];
    const older = cardsForDisplay(messages[0], 0, messages);
    expect(older).toEqual([{ card: messages[0].cards![0], index: 0, mode: "live" }]);
  });
});
