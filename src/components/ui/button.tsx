import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-sm font-semibold transition-[background-color,color,border-color,box-shadow] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-1",
  {
    variants: {
      variant: {
        default:
          "border border-brand bg-brand text-brand-foreground shadow-[var(--shadow-button)] hover:border-brand-hover hover:bg-brand-hover",
        outline:
          "border border-border-strong bg-surface-raised text-foreground shadow-[var(--shadow-raised)] hover:bg-surface-hover",
        ghost: "text-secondary hover:bg-surface-hover hover:text-foreground",
        destructive:
          "border border-destructive bg-destructive text-white shadow-[var(--shadow-button)] hover:bg-destructive/90",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-[9px] px-3 text-xs",
        icon: "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  ),
);
Button.displayName = "Button";
