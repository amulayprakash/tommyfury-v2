import { useParams } from "react-router";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "@/features/auth/login-form";

/** Legacy deep-link target /newlogin/:mobile — the mobile number arrives prefilled. */
export default function NewLoginPage() {
  const { mobile } = useParams<{ mobile: string }>();
  const initialMobile = mobile && /^\d{10}$/.test(mobile) ? mobile : "";

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl">Sign in to continue</CardTitle>
        <CardDescription>
          {initialMobile
            ? `Continue as ${initialMobile.replace(/^(\d{2})\d{5}(\d{3})$/, "$1•••••$2")}`
            : "Sign in with your registered mobile number."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm initialMobile={initialMobile} />
      </CardContent>
    </Card>
  );
}
