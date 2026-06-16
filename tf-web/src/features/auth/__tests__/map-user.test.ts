import { describe, expect, it } from "vitest";

import { extractSignupId, mapUser } from "../map-user";

describe("mapUser", () => {
  it("maps the legacy Laravel field names", () => {
    const user = mapUser({
      id: 7,
      Full_Name: "Ravi Kumar",
      Email: "ravi@example.com",
      mobileno: "9876543210",
      pincode: 400001,
    });

    expect(user).toEqual({
      id: "7",
      name: "Ravi Kumar",
      email: "ravi@example.com",
      mobile: "9876543210",
      address: null,
      pincode: "400001",
    });
  });

  it("maps modern field names too", () => {
    const user = mapUser({
      signup_id: "abc-1",
      name: "Meera",
      email: "meera@example.com",
      mobile: "9123456780",
      address: "12 Lake Road",
    });

    expect(user.id).toBe("abc-1");
    expect(user.name).toBe("Meera");
    expect(user.address).toBe("12 Lake Road");
  });

  it("falls back to a default display name but never a missing id", () => {
    expect(mapUser({ id: "9" }).name).toBe("Customer");
    expect(() => mapUser({ name: "No Id" })).toThrow(/user id/);
  });

  it("ignores empty-string values when picking fields", () => {
    const user = mapUser({ id: "1", name: "", Full_Name: "Actual Name" });
    expect(user.name).toBe("Actual Name");
  });
});

describe("extractSignupId", () => {
  it("prefers signup_id over id", () => {
    expect(extractSignupId({ signup_id: 55, id: 1 })).toBe("55");
    expect(extractSignupId({ id: 1 })).toBe("1");
    expect(extractSignupId({})).toBeNull();
  });
});
