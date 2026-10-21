import type { ButtonHTMLAttributes, ReactElement } from "react";
import clsx from "clsx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const sizeClass: Record<Size, string> = {
  sm: "btn-32",
  md: "",
  lg: "primary--lg",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
}): ReactElement {
  const base =
    variant === "primary"
      ? "primary"
      : variant === "danger"
        ? "danger-btn"
        : "ghost-btn";
  return (
    <button
      type="button"
      className={clsx(base, sizeClass[size], variant === "danger" && size === "lg" && "danger-btn--lg", className)}
      {...rest}
    />
  );
}
