import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { IdvControl } from "../idv-control";

/**
 * The IDV control commits on RELEASE, not on every drag tick.
 *
 * Not a cosmetic preference. `onChange` is wired straight into the compare
 * request on both pages that mount this control, so every emitted value becomes a
 * live premium call at the insurer. Emitting per tick meant one slider sweep
 * fired dozens: the page flickered through a re-quote per step, and on the HDFC
 * harness a shared vendor sandbox absorbed the burst. The typed fallback was
 * worse — a six-digit IDV cost six round trips, one per keystroke.
 *
 * Contract: the number under the thumb tracks the input continuously, and
 * `onChange` fires once, when the gesture ends.
 */

/** Mirrors how both real pages use it: the commit feeds back in as `value`. */
function Harness({ onChange }: { onChange: (v: number | null) => void }) {
  const [value, setValue] = useState<number | null>(500_000);
  return (
    <IdvControl
      value={value}
      min={454_100}
      max={717_000}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

const slider = () => screen.getByRole("slider");
/** One drag tick. React maps the range input's `input` event onto onChange. */
const drag = (to: number) => fireEvent.change(slider(), { target: { value: String(to) } });

describe("IdvControl — slider commits on release", () => {
  it("does not commit while the thumb is being dragged", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    drag(520_000);
    drag(560_000);
    drag(620_000);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the value under the thumb while dragging, without committing", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    drag(620_000);

    expect(screen.getByText("₹6,20,000")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("commits once when the pointer is released, however long the drag was", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    drag(520_000);
    drag(560_000);
    drag(620_000);
    fireEvent.pointerUp(slider());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(620_000);
  });

  it("commits when a keyboard user finishes adjusting", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    drag(455_100);
    fireEvent.keyUp(slider(), { key: "ArrowLeft" });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(455_100);
  });

  it("commits on blur, for a drag that ends outside the control", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    drag(600_000);
    fireEvent.blur(slider());

    expect(onChange).toHaveBeenCalledWith(600_000);
  });

  it("does not re-price when the gesture moved nothing", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    // A click on the thumb: release with no intervening change.
    fireEvent.pointerUp(slider());

    expect(onChange).not.toHaveBeenCalled();
  });

  it("reflects a value changed from outside, so a fresh quote moves the thumb", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <IdvControl value={500_000} min={454_100} max={717_000} onChange={onChange} />,
    );
    rerender(<IdvControl value={457_100} min={454_100} max={717_000} onChange={onChange} />);

    expect(screen.getByText("₹4,57,100")).toBeInTheDocument();
    expect((slider() as HTMLInputElement).value).toBe("457100");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("IdvControl — numeric fallback commits on blur", () => {
  it("does not commit on every keystroke", async () => {
    const onChange = vi.fn();
    render(<IdvControl value={null} onChange={onChange} />);

    await userEvent.type(screen.getByRole("spinbutton"), "457100");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("commits the typed value once, on blur", async () => {
    const onChange = vi.fn();
    render(<IdvControl value={null} onChange={onChange} />);

    await userEvent.type(screen.getByRole("spinbutton"), "457100");
    await userEvent.tab();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(457_100);
  });

  it("commits on Enter, so the keyboard user need not tab away", async () => {
    const onChange = vi.fn();
    render(<IdvControl value={null} onChange={onChange} />);

    await userEvent.type(screen.getByRole("spinbutton"), "457100{Enter}");

    expect(onChange).toHaveBeenCalledWith(457_100);
  });

  it("commits null when cleared, so the vendor default applies again", async () => {
    const onChange = vi.fn();
    render(<IdvControl value={457_100} onChange={onChange} />);

    await userEvent.clear(screen.getByRole("spinbutton"));
    await userEvent.tab();

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
