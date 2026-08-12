import * as React from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const controlClass =
  "h-11 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-[0.95rem] text-ink placeholder:text-ink-subtle disabled:bg-surface-sunken disabled:text-ink-subtle";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(controlClass, className)} {...props} />;
  },
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(controlClass, "h-auto min-h-24 py-2", className)}
      {...props}
    />
  );
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(controlClass, "pr-8", className)} {...props}>
      {children}
    </select>
  );
});

/**
 * Numeric entry tuned for phones: opens the numeric keypad and never silently
 * swallows a decimal point typed with a comma.
 */
export const NumberInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function NumberInput({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      type="number"
      inputMode="decimal"
      step="any"
      className={cn(controlClass, "text-right tabular-nums", className)}
      {...props}
    />
  );
});

export const DatePicker = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function DatePicker({ className, ...props }, ref) {
  return <input ref={ref} type="date" className={cn(controlClass, className)} {...props} />;
});

export function Label({
  className,
  required,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label className={cn("text-sm font-medium text-ink", className)} {...props}>
      {children}
      {required ? <span className="ml-0.5 text-critical">*</span> : null}
    </label>
  );
}

export function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return (
    <p className="flex items-center gap-1.5 text-sm text-critical" role="alert">
      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
      <span>{messages[0]}</span>
    </p>
  );
}

export function Field({
  label,
  htmlFor,
  required,
  hint,
  errors,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  errors?: string[];
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
      <FieldError messages={errors} />
    </div>
  );
}

export function Checkbox({
  className,
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex items-center gap-2.5 text-[0.95rem] text-ink">
      <input
        type="checkbox"
        className={cn("h-5 w-5 rounded border-border-strong accent-brand", className)}
        {...props}
      />
      {label}
    </label>
  );
}
