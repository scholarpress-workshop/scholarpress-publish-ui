import { describe, it, expect, beforeEach } from "bun:test";
import {
  storeSectionChunks,
  getStoredSectionChunks,
} from "../store";

describe("storeSectionChunks / getStoredSectionChunks", () => {
  it("stores and retrieves a single marker", () => {
    storeSectionChunks("s1", "CH1", [1, 2, 3]);
    expect(getStoredSectionChunks("s1")).toEqual({ CH1: [1, 2, 3] });
  });

  it("accumulates multiple markers", () => {
    storeSectionChunks("s2", "CH1", [1, 2]);
    storeSectionChunks("s2", "ABSTRACT", [4, 5]);
    expect(getStoredSectionChunks("s2")).toEqual({
      CH1: [1, 2],
      ABSTRACT: [4, 5],
    });
  });

  it("returns empty object for unknown session", () => {
    expect(getStoredSectionChunks("nonexistent")).toEqual({});
  });

  it("overwrites marker on second call", () => {
    storeSectionChunks("s3", "CH1", [1, 2]);
    storeSectionChunks("s3", "CH1", [3, 4]);
    expect(getStoredSectionChunks("s3")).toEqual({ CH1: [3, 4] });
  });

  it("does not collide across sessions", () => {
    storeSectionChunks("sa", "CH1", [1]);
    storeSectionChunks("sb", "CH1", [2]);
    expect(getStoredSectionChunks("sa")).toEqual({ CH1: [1] });
    expect(getStoredSectionChunks("sb")).toEqual({ CH1: [2] });
  });

  it("handles empty indices array", () => {
    storeSectionChunks("s4", "PREFACE", []);
    expect(getStoredSectionChunks("s4")).toEqual({ PREFACE: [] });
  });
});
