import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { useIdleTimeout } from "./use-idle-timeout";

/** Mounted once at the router root: owns the idle timer + expiry warning dialog. */
export function SessionManager() {
  const { warningOpen, secondsLeft, staySignedIn } = useIdleTimeout();

  return (
    <AlertDialog open={warningOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you still there?</AlertDialogTitle>
          <AlertDialogDescription>
            For your security you will be signed out in{" "}
            <span className="font-semibold text-foreground">{secondsLeft}s</span> due to
            inactivity.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={staySignedIn}>Stay signed in</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
