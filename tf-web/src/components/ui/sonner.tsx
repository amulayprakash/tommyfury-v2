import { Toaster as Sonner, type ToasterProps } from "sonner";

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="top-center"
      toastOptions={{
        classNames: {
          toast: "!bg-card !text-card-foreground !border-border !shadow-lg",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
