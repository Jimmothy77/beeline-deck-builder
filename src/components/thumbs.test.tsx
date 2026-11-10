/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardThumb } from "@/components/thumbs";
import { THUMB_CONCURRENCY, THUMB_RETRIES, ThumbGate } from "@/lib/thumb-load";

class FakeObserver {
  private callback: IntersectionObserverCallback;
  static visible = true;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe() {
    this.callback([{ isIntersecting: FakeObserver.visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

describe("CardThumb", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not show a thumbnail when IntersectionObserver is missing", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const gate = new ThumbGate(4);
    await act(async () => {
      root.render(<CardThumb id="no-observer" alt="Hidden" gate={gate} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector("img")).toBeNull();
  });

  it("does not load a thumbnail until it is on screen, and releases the slot when it unmounts", async () => {
    FakeObserver.visible = false;
    const gate = new ThumbGate(1);
    await act(async () => {
      root.render(<CardThumb id="hidden-file" alt="Hidden" gate={gate} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector("img")).toBeNull();
    await act(() => root.unmount());
    root = createRoot(host);
    FakeObserver.visible = true;
    await act(async () => {
      root.render(<CardThumb id="shown-file" alt="Shown" gate={gate} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector("img")).not.toBeNull();
    await act(() => root.unmount());
    let entered = false;
    const pending = gate.acquire().then(() => {
      entered = true;
    });
    await act(async () => {
      await Promise.resolve();
    });
    await pending;
    expect(entered).toBe(true);
    gate.release();
    root = createRoot(host);
  });

  it("loads more images than the concurrency limit, which a no-op release or a limit of 1000 would fail", async () => {
    FakeObserver.visible = true;
    expect(THUMB_CONCURRENCY).toBeLessThan(8);
    const gate = new ThumbGate(THUMB_CONCURRENCY);
    await act(async () => {
      root.render(
        <div>
          {Array.from({ length: 8 }, (_, index) => (
            <CardThumb key={index} id={`thumb-${index}`} alt={`Card ${index}`} gate={gate} />
          ))}
        </div>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const images = () => [...host.querySelectorAll("img")];
    expect(images()).toHaveLength(THUMB_CONCURRENCY);
    expect(images()[0]?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(images()[0]?.getAttribute("loading")).toBe("eager");
    expect(images()[0]?.getAttribute("src")).toContain("drive.google.com/thumbnail");
    await act(async () => {
      for (const image of images()) image.dispatchEvent(new Event("load"));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(images()).toHaveLength(8);
  });

  it("retries before using the lh3 preview and releases the slot when the image gives up", async () => {
    vi.useFakeTimers();
    const gate = new ThumbGate(1);
    await act(async () => {
      root.render(<CardThumb id="retry-file" alt="Retry" gate={gate} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const image = () => host.querySelector("img");
    expect(image()?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image()?.getAttribute("src")).toContain("https://drive.google.com/thumbnail");
    for (let attempt = 0; attempt < THUMB_RETRIES - 1; attempt += 1) {
      await act(async () => {
        image()?.dispatchEvent(new Event("error"));
        vi.advanceTimersByTime(1_000);
      });
      expect(image()?.getAttribute("src")).toContain("drive.google.com/thumbnail");
    }
    await act(async () => {
      image()?.dispatchEvent(new Event("error"));
    });
    expect(image()?.getAttribute("src")).toContain("lh3.googleusercontent.com");
    for (let attempt = 0; attempt < THUMB_RETRIES; attempt += 1) {
      await act(async () => {
        image()?.dispatchEvent(new Event("error"));
        vi.advanceTimersByTime(1_000);
      });
    }
    expect(host.querySelector("img")).toBeNull();
    let started = false;
    const next = gate.acquire().then(() => {
      started = true;
    });
    await act(async () => {
      await Promise.resolve();
    });
    await next;
    expect(started).toBe(true);
    gate.release();
  });
});
