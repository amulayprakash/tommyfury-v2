import { z } from "zod";

// Kept transform-free (no .default()/.coerce()/.preprocess()) so the zod input
// and output types match — react-hook-form's resolver needs that alignment.
export const proposalSchema = z.object({
  firstName: z.string().min(1, "Enter the first name"),
  lastName: z.string().min(1, "Enter the last name"),
  email: z.email("Enter a valid email address"),
  mobile: z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date of birth"),
  gender: z.enum(["M", "F", "O"]).optional(),

  addressLine1: z.string().min(1, "Enter the address"),
  addressLine2: z.string().optional(),
  city: z.string().min(1, "Enter the city"),
  state: z.string().min(1, "Enter the state"),
  pincode: z.string().regex(/^\d{6}$/, "Enter a valid 6-digit pincode"),

  engineNumber: z.string().min(1, "Enter the engine number"),
  chassisNumber: z.string().min(1, "Enter the chassis number"),
  financeType: z.enum(["none", "hypothecation", "lease"]),
  financierName: z.string().optional(),

  nomineeName: z.string().optional(),
  nomineeRelation: z.string().optional(),
  /** Captured as text; converted to a number when building the proposal. */
  nomineeAge: z.string().regex(/^\d*$/, "Enter a valid age").optional(),
});

export type ProposalValues = z.infer<typeof proposalSchema>;

export const PAN_REGEX = /^[A-Z]{5}\d{4}[A-Z]$/;
