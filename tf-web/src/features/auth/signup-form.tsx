import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import axios from "axios";
import {
  ArrowLeft,
  Hash,
  Loader2,
  LockKeyhole,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { z } from "zod";

import { ROUTES } from "@/app/router/paths";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useCartStore } from "@/features/cart/cart-store";

import {
  login,
  parseRegisterError,
  registerCustomer,
  sendSignupOtp,
  verifySignupOtp,
  type RegisterDetails,
} from "./api";
import { useAuthStore } from "./auth-store";

const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name"),
  mobile: z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
  email: z.email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  address: z.string().trim().min(5, "Enter your full address"),
  pincode: z.string().regex(/^\d{6}$/, "Enter a valid 6-digit pincode"),
});

type SignupValues = z.infer<typeof signupSchema>;

type Step = "details" | "otp";
type SignupStage = "otp" | "register" | "login";

/** The legacy Tommy & Furry backend sends a 4-digit OTP. */
const OTP_LENGTH = 4;

/** Tags which step of the verify → register → login chain failed. */
class SignupStageError extends Error {
  readonly stage: SignupStage;
  readonly original: unknown;

  constructor(stage: SignupStage, original: unknown) {
    super(`Signup failed at the ${stage} stage`);
    this.name = "SignupStageError";
    this.stage = stage;
    this.original = original;
  }
}

function maskMobile(mobile: string): string {
  return /^\d{10}$/.test(mobile) ? mobile.replace(/^(\d{2})\d{5}(\d{3})$/, "$1•••••$2") : mobile;
}

function otpRequestErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (axios.isAxiosError(error) && !error.response) {
    return "Could not reach the server. Check your connection.";
  }
  return "Could not send the OTP. Please try again.";
}

export function SignupForm({ initialMobile = "" }: { initialMobile?: string }) {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const adoptGuestCart = useCartStore((state) => state.adoptGuestCart);

  const [step, setStep] = useState<Step>("details");
  const [details, setDetails] = useState<RegisterDetails | null>(null);
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: "",
      mobile: initialMobile,
      email: "",
      password: "",
      address: "",
      pincode: "",
    },
  });

  const sendOtpMutation = useMutation({
    mutationFn: sendSignupOtp,
    onSuccess: (_data, mobile) => {
      setOtp("");
      setOtpError(null);
      setStep("otp");
      toast.success(`OTP sent to ${maskMobile(mobile)}`);
    },
    onError: (error) => toast.error(otpRequestErrorMessage(error)),
  });

  const finishMutation = useMutation({
    mutationFn: async ({ data, code }: { data: RegisterDetails; code: string }) => {
      try {
        await verifySignupOtp(data.mobile, code);
      } catch (error) {
        throw new SignupStageError("otp", error);
      }
      try {
        await registerCustomer(data);
      } catch (error) {
        throw new SignupStageError("register", error);
      }
      try {
        return await login({ mobile: data.mobile, password: data.password });
      } catch (error) {
        throw new SignupStageError("login", error);
      }
    },
    onSuccess: (session) => {
      setSession(session);
      adoptGuestCart(session.user.id);
      toast.success(`Welcome to Tommy & Furry, ${session.user.name.split(" ")[0]}!`);
      void navigate(ROUTES.home, { replace: true });
    },
    onError: (error) => {
      if (!(error instanceof SignupStageError)) {
        toast.error("Something went wrong. Please try again.");
        return;
      }

      if (error.stage === "otp") {
        const message =
          error.original instanceof Error
            ? error.original.message
            : "The OTP you entered is invalid or has expired.";
        setOtpError(message);
        toast.error(message);
        return;
      }

      if (error.stage === "register") {
        const { fieldErrors, message } = parseRegisterError(error.original);
        for (const fieldError of fieldErrors) {
          form.setError(fieldError.field, { message: fieldError.message });
        }
        // Field errors live on the details step — send the user back to fix them.
        setStep("details");
        toast.error(message);
        return;
      }

      // Account was created but the automatic sign-in failed: hand off to the
      // login screen with the mobile prefilled so the user can finish manually.
      toast.success("Account created! Please sign in to continue.");
      const mobile = details?.mobile ?? "";
      void navigate(mobile ? ROUTES.auth.newLoginFor(mobile) : ROUTES.auth.login, {
        replace: true,
      });
    },
  });

  const onDetailsSubmit = (values: SignupValues) => {
    setDetails(values);
    sendOtpMutation.mutate(values.mobile);
  };

  const onVerifySubmit = () => {
    if (!details) return;
    if (otp.length !== OTP_LENGTH) {
      setOtpError(`Enter the ${OTP_LENGTH}-digit OTP.`);
      return;
    }
    setOtpError(null);
    finishMutation.mutate({ data: details, code: otp });
  };

  if (step === "otp" && details) {
    return (
      <div className="space-y-5">
        <div className="space-y-1 text-center">
          <p className="text-sm text-muted-foreground">
            Enter the {OTP_LENGTH}-digit code sent to{" "}
            <span className="font-medium text-foreground">+91 {maskMobile(details.mobile)}</span>
          </p>
        </div>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onVerifySubmit();
          }}
          noValidate
        >
          <div className="space-y-2">
            <Input
              value={otp}
              onChange={(event) => {
                setOtp(event.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH));
                setOtpError(null);
              }}
              type="tel"
              inputMode="numeric"
              maxLength={OTP_LENGTH}
              autoComplete="one-time-code"
              autoFocus
              placeholder={Array(OTP_LENGTH).fill("•").join(" ")}
              className="text-center text-lg tracking-[0.5em]"
              aria-label="One-time password"
              aria-invalid={Boolean(otpError)}
            />
            {otpError ? <p className="text-xs font-medium text-destructive">{otpError}</p> : null}
          </div>

          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={finishMutation.isPending || otp.length !== OTP_LENGTH}
          >
            {finishMutation.isPending ? (
              <>
                <Loader2 className="animate-spin" /> Creating your account…
              </>
            ) : (
              <>
                <ShieldCheck /> Verify &amp; create account
              </>
            )}
          </Button>
        </form>

        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => {
              setStep("details");
              setOtpError(null);
            }}
            disabled={finishMutation.isPending}
          >
            <ArrowLeft className="size-4" /> Edit details
          </button>
          <button
            type="button"
            className="font-medium text-primary transition-colors hover:underline disabled:opacity-60"
            onClick={() => sendOtpMutation.mutate(details.mobile)}
            disabled={sendOtpMutation.isPending || finishMutation.isPending}
          >
            {sendOtpMutation.isPending ? "Sending…" : "Resend OTP"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(onDetailsSubmit)} noValidate>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full name</FormLabel>
              <FormControl>
                <div className="relative">
                  <UserRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input {...field} placeholder="Asha Rao" autoComplete="name" className="pl-9" />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="mobile"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Mobile number</FormLabel>
              <FormControl>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    {...field}
                    onChange={(event) =>
                      field.onChange(event.target.value.replace(/\D/g, "").slice(0, 10))
                    }
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="9876543210"
                    autoComplete="tel-national"
                    className="pl-9"
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    {...field}
                    type="email"
                    placeholder="asha@example.com"
                    autoComplete="email"
                    className="pl-9"
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <div className="relative">
                  <LockKeyhole className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    {...field}
                    type="password"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    className="pl-9"
                  />
                </div>
              </FormControl>
              <FormDescription>At least 8 characters.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address</FormLabel>
              <FormControl>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    {...field}
                    placeholder="House no, street, area, city"
                    autoComplete="street-address"
                    className="pl-9"
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="pincode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Pincode</FormLabel>
              <FormControl>
                <div className="relative">
                  <Hash className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    {...field}
                    onChange={(event) =>
                      field.onChange(event.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    type="tel"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="400001"
                    autoComplete="postal-code"
                    className="pl-9"
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" size="lg" disabled={sendOtpMutation.isPending}>
          {sendOtpMutation.isPending ? (
            <>
              <Loader2 className="animate-spin" /> Sending OTP…
            </>
          ) : (
            "Continue"
          )}
        </Button>
      </form>
    </Form>
  );
}
