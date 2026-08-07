import { describe, it, expect } from "vitest";
import { ValidationError } from "@/errors/app-error.ts";
import { requireFields } from "../require-fields.ts";

describe("requireFields", () => {
  it("passes when every named field is present", () => {
    expect(() => requireFields({ a: 1, b: "x" }, ["a", "b"], "fg")).not.toThrow();
  });

  it("raises a ValidationError naming every missing field at once", () => {
    let caught: unknown;
    try {
      requireFields({ a: 1 } as { a: number; b?: string; c?: string }, ["a", "b", "c"], "fg");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).message).toBeTruthy();
    const details = (caught as ValidationError).details as { path: string[]; message: string }[];
    expect(details.map((d) => d.path[0])).toEqual(["b", "c"]);
    expect(details[0]!.message).toContain("fg");
  });

  it("treats empty strings as missing", () => {
    expect(() => requireFields({ a: "" }, ["a"], "fg")).toThrow(ValidationError);
  });

  it("treats zero and false as present", () => {
    expect(() => requireFields({ a: 0, b: false }, ["a", "b"], "fg")).not.toThrow();
  });
});
