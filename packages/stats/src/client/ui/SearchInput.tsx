import { Search } from "lucide-react";
import { t } from "../i18n";

export interface SearchInputProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	width?: number;
}

/** Text filter with a leading search glyph. */
export function SearchInput({ value, onChange, placeholder = t("common.filter"), width }: SearchInputProps) {
	return (
		<label className="search">
			<Search size={14} />
			<input
				className="input"
				type="search"
				value={value}
				placeholder={placeholder}
				onChange={e => onChange(e.target.value)}
				style={width !== undefined ? { width } : undefined}
			/>
		</label>
	);
}
