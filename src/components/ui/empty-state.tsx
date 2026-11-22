import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, children }: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="panel empty-state">
      <span className="icon-tile"><Icon aria-hidden="true" size={21} /></span>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}
