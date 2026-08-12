import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
  {
    variants: {
      variant: {
        primary: "bg-brand text-ink-inverse hover:bg-brand-hover",
        secondary: "bg-surface text-ink border border-border-strong hover:bg-surface-muted",
        ghost: "text-ink-muted hover:bg-surface-sunken hover:text-ink",
        danger: "bg-critical text-ink-inverse hover:opacity-90",
        link: "text-brand underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-9 px-3 text-sm",
        md: "h-11 px-4 text-[0.95rem]",
        /** Frontline default: thumb-sized, readable at arm's length. */
        lg: "h-14 px-6 text-lg",
        icon: "h-11 w-11",
        iconSm: "h-9 w-9",
      },
      block: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: { variant: "primary", size: "md", block: false },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
  };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, asChild = false, loading = false, children, disabled, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>กำลังบันทึก...</span>
        </>
      ) : (
        children
      )}
    </Comp>
  );
});

export type IconButtonProps = Omit<ButtonProps, "size"> & {
  label: string;
  size?: "icon" | "iconSm";
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "icon", variant = "ghost", ...props },
  ref,
) {
  return <Button ref={ref} aria-label={label} title={label} size={size} variant={variant} {...props} />;
});

export { buttonVariants };
