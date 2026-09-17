import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/coss/ui/select.tsx";
import { cn } from "@/lib/cn.ts";

export type Option = { value: string; label: string };

const ALL = "__all__";

/** Single select over string options; with `allLabel`, an "all" option maps to `undefined`. */
export function OptionSelect({
  label,
  value,
  options,
  onChange,
  allLabel,
  disabled,
  className,
}: {
  label: string;
  value: string | undefined;
  options: Option[];
  onChange: (value: string | undefined) => void;
  allLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const items = allLabel ? [{ value: ALL, label: allLabel }, ...options] : options;
  return (
    <Select
      items={items}
      value={value ?? (allLabel ? ALL : null)}
      disabled={disabled}
      onValueChange={(next) => onChange(next === null || next === ALL ? undefined : next)}
    >
      <SelectTrigger aria-label={label} className={cn("min-w-0", className)}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectPopup>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
