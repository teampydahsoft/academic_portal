import { cn } from "@/lib/cn";

type Props = {
  title: React.ReactNode;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({ title, description, actions, className }: Props) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-start justify-between gap-3", className)}>
      <div>
        <div className="text-[28px] font-semibold leading-tight text-navy-900">
          {title}
        </div>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm text-slate-500 print:hidden">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
