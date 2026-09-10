import { describe, expect, it } from "vitest";
import { createCache, targetsKey, observersKey, userKey, placeKey } from "../server/cache.js";

describe("cache", () => {
  it("returns undefined before set and the value after", () => {
    const c = createCache(10);
    expect(c.get("a")).toBeUndefined();
    c.set("a", 1, 60);
    expect(c.get<number>("a")).toBe(1);
  });

  it("expires entries after their TTL", () => {
    let t = 0;
    const c = createCache(10, () => t);
    c.set("a", "v", 1); // expires at 1000ms
    t = 999;
    expect(c.get("a")).toBe("v");
    t = 1000;
    expect(c.get("a")).toBeUndefined();
    expect(c.has("a")).toBe(false);
  });

  it("evicts the least-recently-used entry past the max", () => {
    const c = createCache(2);
    c.set("a", 1, 60);
    c.set("b", 2, 60);
    c.get("a"); // touch a so b is now oldest
    c.set("c", 3, 60);
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("c")).toBe(3);
    expect(c.size()).toBe(2);
  });

  it("builds a persistence-ready, lowercased target key", () => {
    expect(targetsKey(14, 9, undefined, "Kueda")).toBe("targets:v1:14:9:all:kueda");
    expect(targetsKey(14, 9, 47126, "kueda")).toBe("targets:v1:14:9:47126:kueda");
    expect(observersKey(5, 14, 9)).toBe("obs:v1:5:14:9");
    expect(userKey("Kueda")).toBe("user:v1:kueda");
    expect(placeKey(" Cal ")).toBe("place:v1:cal");
  });
});
