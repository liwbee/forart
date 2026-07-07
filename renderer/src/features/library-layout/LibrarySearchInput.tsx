import { Search, X } from "lucide-react";

interface LibrarySearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  clearLabel: string;
  className?: string;
  disabled?: boolean;
}

export function LibrarySearchInput({ value, onChange, placeholder, clearLabel, className = "", disabled = false }: LibrarySearchInputProps) {
  return (
    <label className={`library-search${className ? ` ${className}` : ""}`}>
      <Search size={18} aria-hidden="true" />
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value ? (
        <button type="button" disabled={disabled} aria-label={clearLabel} onClick={() => onChange("")}>
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </label>
  );
}
