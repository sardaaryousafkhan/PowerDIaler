import type { HTMLAttributes, ReactElement } from "react";
import clsx from "clsx";

export function Card({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>): ReactElement {
  return (
    <div className={clsx("panel panel-lift", className)} {...rest}>
      {children}
    </div>
  );
}
