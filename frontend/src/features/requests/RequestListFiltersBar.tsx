"use client";

import { FilterBar, FilterField } from "@/components/ui/FilterBar";
import {
  DEFAULT_REQUEST_LIST_FILTERS,
  REQUEST_STATUS_OPTIONS,
  type RequestListFilters,
} from "./request-filters";

const selectClassName =
  "h-11 sm:h-9 w-full rounded-md border border-border bg-white px-2 text-sm text-foreground outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600";

type Props = {
  filters: RequestListFilters;
  onChange: (filters: RequestListFilters) => void;
  typeOptions: { typeKey: string; label: string }[];
  collegeOptions: { id: number; name: string }[];
  branchOptions: { id: number; name: string }[];
};

export function RequestListFiltersBar({
  filters,
  onChange,
  typeOptions,
  collegeOptions,
  branchOptions,
}: Props) {
  function update<K extends keyof RequestListFilters>(key: K, value: RequestListFilters[K]) {
    onChange({ ...filters, [key]: value });
  }

  const hasActiveFilters =
    filters.typeKey !== "all" ||
    filters.status !== "all" ||
    filters.sessionDate !== "" ||
    filters.collegeId !== "all" ||
    filters.branchId !== "all";

  return (
    <FilterBar>
      <FilterField label="Request type">
        <select
          className={selectClassName}
          value={filters.typeKey}
          onChange={(event) => update("typeKey", event.target.value)}
        >
          <option value="all">All types</option>
          {typeOptions.map((type) => (
            <option key={type.typeKey} value={type.typeKey}>
              {type.label}
            </option>
          ))}
        </select>
      </FilterField>

      <FilterField label="Status">
        <select
          className={selectClassName}
          value={filters.status}
          onChange={(event) => update("status", event.target.value)}
        >
          {REQUEST_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FilterField>

      <FilterField label="Date">
        <input
          type="date"
          className={selectClassName}
          value={filters.sessionDate}
          onChange={(event) => update("sessionDate", event.target.value)}
        />
      </FilterField>

      <FilterField label="College">
        <select
          className={selectClassName}
          value={filters.collegeId}
          onChange={(event) => update("collegeId", event.target.value)}
        >
          <option value="all">All colleges</option>
          {collegeOptions.map((college) => (
            <option key={college.id} value={String(college.id)}>
              {college.name}
            </option>
          ))}
        </select>
      </FilterField>

      <FilterField label="Branch">
        <select
          className={selectClassName}
          value={filters.branchId}
          onChange={(event) => update("branchId", event.target.value)}
        >
          <option value="all">All branches</option>
          {branchOptions.map((branch) => (
            <option key={branch.id} value={String(branch.id)}>
              {branch.name}
            </option>
          ))}
        </select>
      </FilterField>

      {hasActiveFilters ? (
        <div className="flex w-full items-end sm:w-auto">
          <button
            type="button"
            className="h-11 sm:h-9 rounded-md border border-border bg-white px-3 text-sm text-slate-600 hover:bg-slate-50"
            onClick={() => onChange(DEFAULT_REQUEST_LIST_FILTERS)}
          >
            Clear filters
          </button>
        </div>
      ) : null}
    </FilterBar>
  );
}
