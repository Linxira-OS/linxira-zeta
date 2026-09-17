/** Left-ellipsis path label (keeps the tail visible). Shared inline copy —
 *  the original lives inside SessionSidebar.tsx and is not exported. */
export function PathLabel({ text, style }: { text: string; style?: React.CSSProperties }) {
	return (
		<span
			dir="rtl"
			style={{
				display: "block",
				unicodeBidi: "plaintext",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				...style,
			}}
		>
			{text}
		</span>
	);
}
