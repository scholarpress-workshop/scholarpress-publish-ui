import { describe, it, expect } from "bun:test";
import {
  storeSectionStart,
  getStoredSectionStarts,
} from "../store";

describe("storeSectionStart / getStoredSectionStarts", () => {
  it("stores heading text", () => {
    storeSectionStart("s1", "CH1", { heading: "Introduction" });
    expect(getStoredSectionStarts("s1")).toEqual({
      CH1: { heading: "Introduction" },
    });
  });

  it("stores position offset", () => {
    storeSectionStart("s2", "CH1", { position: 1500 });
    expect(getStoredSectionStarts("s2")).toEqual({
      CH1: { position: 1500 },
    });
  });

  it("accumulates multiple markers", () => {
    storeSectionStart("s3", "CH1", { heading: "Intro" });
    storeSectionStart("s3", "ABSTRACT", { heading: "Abstract" });
    expect(getStoredSectionStarts("s3")).toEqual({
      CH1: { heading: "Intro" },
      ABSTRACT: { heading: "Abstract" },
    });
  });

  it("returns empty for unknown session", () => {
    expect(getStoredSectionStarts("nonexistent")).toEqual({});
  });

  it("overwrites marker on second call", () => {
    storeSectionStart("s4", "CH1", { heading: "Old" });
    storeSectionStart("s4", "CH1", { heading: "New" });
    expect(getStoredSectionStarts("s4")).toEqual({
      CH1: { heading: "New" },
    });
  });

  it("does not collide across sessions", () => {
    storeSectionStart("sa", "CH1", { heading: "A" });
    storeSectionStart("sb", "CH1", { heading: "B" });
    expect(getStoredSectionStarts("sa")).toEqual({ CH1: { heading: "A" } });
    expect(getStoredSectionStarts("sb")).toEqual({ CH1: { heading: "B" } });
  });
});
