import * as React from "react";

import { cn } from "@/lib/utils";
import { Input } from "./input";

/**
 * Date field that always reads and writes **dd/mm/yyyy** on screen while keeping
 * the canonical ISO `yyyy-mm-dd` in state (which is what every API contract and
 * every date comparison in this app expects).
 *
 * A native `<input type="date">` renders in the *browser's* locale, not the
 * page's, so it shows mm/dd/yyyy for anyone on a US-English browser — we can't
 * pin the format there. A text field can.
 */

/** "yyyy-mm-dd" → "dd/mm/yyyy" ("" when absent or malformed). */
export function isoToDisplay(iso: string | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** "dd/mm/yyyy" → "yyyy-mm-dd", or null when incomplete/not a real calendar date. */
export function displayToIso(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2100) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // Rejects 31/02/2026 and friends — Date normalises them to the next month.
  const d = new Date(`${iso}T00:00:00Z`);
  return d.getUTCDate() === day && d.getUTCMonth() + 1 === month ? iso : null;
}

/** Keeps only digits and auto-inserts the two slashes as the user types. */
function mask(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
  return parts.join("/");
}

/** Why a part-typed value can't become a date — null while it's merely unfinished. */
export function dateError(text: string): string | null {
  const digits = text.replace(/\D/g, "");
  if (digits.length === 0) return null;
  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  // Flag an impossible day/month as soon as both its digits are in, rather than
  // waiting for the year — "23/23" is already wrong at the fourth keystroke.
  if (digits.length >= 2 && (day < 1 || day > 31)) return "Day must be between 01 and 31.";
  if (digits.length >= 4 && (month < 1 || month > 12)) return "Month must be between 01 and 12.";
  if (digits.length < 8) return "Enter the full date as dd/mm/yyyy.";
  return displayToIso(text) ? null : "That date doesn't exist. Use dd/mm/yyyy.";
}

export function DateInput({
  value,
  onChange,
  showError = true,
  className,
  onBlur,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  /** ISO `yyyy-mm-dd` (or "" / undefined when unset). */
  value: string | undefined;
  /** Fires with ISO `yyyy-mm-dd`, or "" once the field no longer holds a valid date. */
  onChange: (iso: string) => void;
  /** Set false inside a `FormControl` (Slot takes one child; FormMessage reports instead). */
  showError?: boolean;
}) {
  const [text, setText] = React.useState(() => isoToDisplay(value));
  const [seenValue, setSeenValue] = React.useState(value);
  const [touched, setTouched] = React.useState(false);

  // Follow the parent when it changes the value from elsewhere (RC lookup, reset),
  // but never fight the user mid-edit over a value they themselves produced.
  // Adjusted during render rather than in an effect — see React's "adjusting
  // state when a prop changes" pattern.
  if (value !== seenValue) {
    setSeenValue(value);
    if (displayToIso(text) !== (value ?? "")) setText(isoToDisplay(value));
  }

  const error = dateError(text);
  // Don't scold someone mid-keystroke: an unfinished date only complains once
  // they leave the field, but an impossible one is called out immediately.
  const visible = Boolean(error) && (touched || !error!.startsWith("Enter the full"));

  const handle = (raw: string) => {
    const masked = mask(raw);
    setText(masked);
    const iso = displayToIso(masked);
    if (iso) onChange(iso);
    else if (value) onChange("");
  };

  const field = (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      placeholder={props.placeholder ?? "dd/mm/yyyy"}
      value={text}
      aria-invalid={visible || undefined}
      className={cn(
        visible && "border-destructive focus-visible:ring-destructive",
        className,
      )}
      onChange={(e) => handle(e.target.value)}
      onBlur={(e) => {
        setTouched(true);
        onBlur?.(e);
      }}
    />
  );

  if (!showError) return field;
  return (
    <span className="block space-y-1">
      {field}
      {visible ? <span className="block text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
