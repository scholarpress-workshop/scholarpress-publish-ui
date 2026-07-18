import { describe, it, expect } from "bun:test";
import {
  storeSectionStart,
  getStoredSectionStarts,
} from "../store";

describe("storeSectionStart / getStoredSectionStarts", () => {
  it("stores and retrieves a single marker", () => {
    storeSectionStart("s1", "CH1", 1500);
    expect(getStoredSectionStarts("s1")).toEqual({ CH1: 1500 });
  });

  it("accumulates multiple markers", () => {
    storeSectionStart("s2", "CH1", 1500);
    storeSectionStart("s2", "ABSTRACT", 800);
    expect(getStoredSectionStarts("s2")).toEqual({
      CH1: 1500,
      ABSTRACT: 800,
    });
  });

  it("returns empty object for unknown session", () => {
    expect(getStoredSectionStarts("nonexistent")).toEqual({});
  });

  it("overwrites marker on second call", () => {
    storeSectionStart("s3", "CH1", 1500);
    storeSectionStart("s3", "CH1", 1600);
    expect(getStoredSectionStarts("s3")).toEqual({ CH1: 1600 });
  });

  it("does not collide across sessions", () => {
    storeSectionStart("sa", "CH1", 1500);
    storeSectionStart("sb", "CH1", 3000);
    expect(getStoredSectionStarts("sa")).toEqual({ CH1: 1500 });
    expect(getStoredSectionStarts("sb")).toEqual({ CH1: 3000 });
  });
});
