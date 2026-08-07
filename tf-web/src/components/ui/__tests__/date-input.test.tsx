import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { DateInput, dateError, displayToIso, isoToDisplay } from "../date-input";

describe("isoToDisplay", () => {
  it("renders ISO as dd/mm/yyyy", () => {
    expect(isoToDisplay("2026-02-01")).toBe("01/02/2026");
    expect(isoToDisplay("2027-10-04")).toBe("04/10/2027");
  });

  it("returns empty for missing or malformed input", () => {
    expect(isoToDisplay(undefined)).toBe("");
    expect(isoToDisplay("")).toBe("");
    expect(isoToDisplay("01/02/2026")).toBe("");
  });
});

describe("displayToIso", () => {
  it("parses dd/mm/yyyy — day first, never month first", () => {
    expect(displayToIso("01/02/2026")).toBe("2026-02-01");
    // The whole point: 04/10 is 4 October, not 10 April.
    expect(displayToIso("04/10/2027")).toBe("2027-10-04");
  });

  it("returns null while the date is still incomplete", () => {
    expect(displayToIso("")).toBeNull();
    expect(displayToIso("01")).toBeNull();
    expect(displayToIso("01/02")).toBeNull();
  });

  it("rejects dates that don't exist on the calendar", () => {
    expect(displayToIso("31/02/2026")).toBeNull();
    expect(displayToIso("32/01/2026")).toBeNull();
    expect(displayToIso("01/13/2026")).toBeNull();
  });

  it("round-trips with isoToDisplay", () => {
    for (const iso of ["2026-08-20", "2029-01-31", "1990-05-15"]) {
      expect(displayToIso(isoToDisplay(iso))).toBe(iso);
    }
  });
});

describe("dateError", () => {
  it("stays quiet on an empty or still-being-typed field", () => {
    expect(dateError("")).toBeNull();
    expect(dateError("0")).toBe("Enter the full date as dd/mm/yyyy.");
    expect(dateError("01/02")).toBe("Enter the full date as dd/mm/yyyy.");
  });

  it("names an impossible day or month as soon as both digits are in", () => {
    expect(dateError("23/23")).toBe("Month must be between 01 and 12.");
    expect(dateError("32")).toBe("Day must be between 01 and 31.");
    expect(dateError("00")).toBe("Day must be between 01 and 31.");
  });

  it("rejects a complete date that isn't on the calendar", () => {
    expect(dateError("31/02/2026")).toBe("That date doesn't exist. Use dd/mm/yyyy.");
  });

  it("passes a valid date", () => {
    expect(dateError("01/02/2026")).toBeNull();
  });
});

function Harness({ initial = "" }: { initial?: string }) {
  const [iso, setIso] = useState(initial);
  return (
    <>
      <DateInput value={iso} onChange={setIso} aria-label="date" />
      <output>{iso || "(empty)"}</output>
    </>
  );
}

describe("DateInput", () => {
  it("auto-inserts slashes and emits ISO once the date is complete", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("date");

    await user.type(input, "01022026");

    expect(input).toHaveValue("01/02/2026");
    expect(screen.getByRole("status")).toHaveTextContent("2026-02-01");
  });

  it("flags an impossible month immediately, without waiting for blur", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText("date"), "2323");

    expect(screen.getByText("Month must be between 01 and 12.")).toBeInTheDocument();
    expect(screen.getByLabelText("date")).toHaveAttribute("aria-invalid", "true");
  });

  it("holds its tongue on a half-typed date until the field is left", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("date");

    await user.type(input, "0102");
    expect(screen.queryByText(/Enter the full date/)).not.toBeInTheDocument();

    await user.tab();
    expect(screen.getByText("Enter the full date as dd/mm/yyyy.")).toBeInTheDocument();
  });

  it("clears the ISO value when a valid date is edited into an invalid one", async () => {
    const user = userEvent.setup();
    render(<Harness initial="2026-02-01" />);
    const input = screen.getByLabelText("date");
    expect(input).toHaveValue("01/02/2026");

    await user.clear(input);
    await user.type(input, "3102");

    expect(screen.getByRole("status")).toHaveTextContent("(empty)");
  });

  it("renders bare (no wrapper, no message) when showError is off", () => {
    const onChange = vi.fn();
    const { container } = render(
      <DateInput value="2026-02-01" onChange={onChange} showError={false} aria-label="dob" />,
    );
    expect(container.querySelector("span")).toBeNull();
    expect(screen.getByLabelText("dob")).toHaveValue("01/02/2026");
  });
});
