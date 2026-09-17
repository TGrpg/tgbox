import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-muted-foreground text-sm">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
