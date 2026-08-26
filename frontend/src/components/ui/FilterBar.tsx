import { cn } from "@/lib/cn";

type Props = {
  children: React.ReactNode;
  className?: string;
};

export function FilterBar({ children, className }: Props) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

type FieldProps = {
  label: string;
  children: React.ReactNode;
};

export function FilterField({ label, children }: FieldProps) {
  return (
    <label className="flex min-w-[140px] flex-col gap-1 text-xs font-medium text-slate-500">
      {label}
      {children}
    </label>
  );
}

/** Keep first occurrence; removes duplicate labels like multiple "CSE" branches. */
export function uniqueOptions(options: string[]) {
  return Array.from(new Set(options.filter(Boolean)));
}

export function SelectFilter({
  options,
  defaultValue,
}: {
  options: string[];
  defaultValue?: string;
}) {
  const unique = uniqueOptions(options);
  const selected =
    defaultValue && unique.includes(defaultValue) ? defaultValue : unique[0];

  return (
    <select
      defaultValue={selected}
      className="h-9 rounded-md border border-border bg-white px-2 text-sm text-foreground outline-none focus:border-navy-800"
    >
      {unique.map((option, index) => (
        <option key={`${option}__${index}`} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

export function SearchInput({
  placeholder = "Search…",
}: {
  placeholder?: string;
}) {
  return (
    <input
      type="search"
      placeholder={placeholder}
      className="h-9 w-full min-w-[220px] rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-navy-800"
    />
  );
}
