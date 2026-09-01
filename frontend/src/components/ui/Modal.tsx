"use client";

import { Button } from "@/components/ui/Button";

type Props = {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  headerActions?: React.ReactNode;
};

export function Modal({ title, children, onClose, wide, headerActions }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        className={`relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl border border-border bg-white shadow-xl ${
          wide ? "max-w-3xl" : "max-w-2xl"
        }`}
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-white px-5 py-3">
          <h3 className="font-semibold text-navy-900">{title}</h3>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {headerActions}
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
