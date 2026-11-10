import { describe, expect, it } from "vitest";
import { ThumbGate, retryDelayMs, thumbSources } from "@/lib/thumb-load";

describe("card thumbnails", () => {
  it("asks Drive without a referrer host and falls back to the lh3 image", () => {
    const [drive, fallback] = thumbSources("file id/1");
    expect(drive).toBe("https://drive.google.com/thumbnail?id=file%20id%2F1&sz=w400");
    expect(fallback).toBe("https://lh3.googleusercontent.com/d/file%20id%2F1=w400");
    expect(retryDelayMs(0)).toBe(250);
    expect(retryDelayMs(2)).toBe(1000);
  });

  it("loads only a few thumbs at once", async () => {
    const gate = new ThumbGate(2);
    await gate.acquire();
    await gate.acquire();
    let entered = false;
    const third = gate.acquire().then(() => {
      entered = true;
    });
    await Promise.resolve();
    expect(entered).toBe(false);
    gate.release();
    await third;
    expect(entered).toBe(true);
    gate.release();
    gate.release();
  });
});
