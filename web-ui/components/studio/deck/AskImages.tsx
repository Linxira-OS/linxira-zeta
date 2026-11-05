"use client";

/**
 * Image answers for an Ask card.
 *
 * Ported from OMP Studio (MIT) `deck/AskImages.tsx`. A file under 96 KB is sent
 * as-is; a larger one is re-encoded to JPEG at 1280/800/480 px until it fits the
 * response budget, which is what the Host accepts for an inline answer image.
 */

import { useEffect, useRef, useState } from "react";
import type { AskImage } from "@/lib/studio-protocol/protocol";
import { fileToPromptImage, imagePreviewUrl } from "./ingest";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 96 * 1024;
const MAX_IMAGES = 4;

export async function askImage(file: File): Promise<AskImage> {
	if (!ACCEPTED_TYPES.includes(file.type) || file.size > MAX_INPUT_BYTES) {
		throw Error("Choose PNG, JPEG, GIF or WebP under 20 MB / 请选择 20 MB 以内的图片");
	}
	if (file.size <= MAX_RESPONSE_BYTES) return (await fileToPromptImage(file)) as AskImage;
	const bitmap = await createImageBitmap(file);
	try {
		const canvas = document.createElement("canvas");
		for (const edge of [1280, 800, 480]) {
			const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
			canvas.width = Math.max(1, Math.round(bitmap.width * scale));
			canvas.height = Math.max(1, Math.round(bitmap.height * scale));
			const context = canvas.getContext("2d")!;
			context.fillStyle = "#fff"; // zeta-style-literal-allow: canvas matte behind the JPEG re-encode, not theme paint
			context.fillRect(0, 0, canvas.width, canvas.height);
			context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			const deferred = Promise.withResolvers<Blob | null>();
			canvas.toBlob(blob => deferred.resolve(blob), "image/jpeg", 0.7);
			const blob = await deferred.promise;
			if (blob && blob.size <= MAX_RESPONSE_BYTES) {
				return (await fileToPromptImage(new File([blob], "attachment.jpg", { type: "image/jpeg" }))) as AskImage;
			}
		}
		throw Error("Image exceeds response budget / 图片超出回答容量");
	} finally {
		bitmap.close();
	}
}

export function AskImages({
	images,
	onChange,
	disabled,
	label,
	files,
	onBusy,
}: {
	images: readonly AskImage[];
	onChange: (images: readonly AskImage[]) => void;
	disabled?: boolean | undefined;
	label: string;
	files?: readonly File[] | undefined;
	onBusy?: (busy: boolean) => void;
}) {
	const [error, setError] = useState("");
	const [preview, setPreview] = useState<AskImage>();
	const [busy, setBusy] = useState(false);
	const epoch = useRef(0);
	const input = useRef<HTMLInputElement>(null);
	const current = useRef(images);
	current.current = images;

	useEffect(() => () => {
		epoch.current++;
	}, []);
	useEffect(() => {
		onBusy?.(busy);
		return () => onBusy?.(false);
	}, [busy, onBusy]);

	const add = async (next: readonly File[]) => {
		if (disabled || busy) return;
		const generation = epoch.current;
		setBusy(true);
		try {
			if (current.current.length + next.length > MAX_IMAGES) {
				throw Error("At most 4 images per answer field / 每个回答区最多 4 张图片");
			}
			const added: AskImage[] = [];
			for (const file of next) added.push(await askImage(file));
			if (epoch.current === generation) {
				onChange([...current.current, ...added]);
				setError("");
			}
		} catch (cause) {
			if (epoch.current === generation) setError(String(cause));
		} finally {
			if (epoch.current === generation) setBusy(false);
		}
	};
	useEffect(() => {
		if (files?.length) void add(files);
	}, [files]);

	return (
		<div className="ask-images">
			<input
				ref={input}
				type="file"
				accept={ACCEPTED_TYPES.join(",")}
				multiple
				hidden
				onChange={event => {
					void add([...(event.target.files ?? [])]);
					event.target.value = "";
				}}
			/>
			<button type="button" className="btn small outline" disabled={disabled || busy} onClick={() => input.current?.click()}>
				{label} + {busy ? "…" : "图片 / Image"}
			</button>
			{images.map((image, index) => (
				<span key={index} className="ask-image-thumb">
					<button
						type="button"
						className="icon-btn"
						aria-label={`${label} ${index + 1}`}
						onClick={() => setPreview(image)}
					>
						<img src={imagePreviewUrl(image)} alt={`${label} ${index + 1}`} className="ask-image-thumb-img" />
					</button>
					<button
						type="button"
						disabled={disabled}
						aria-label={`删除 / Remove ${label} ${index + 1}`}
						onClick={() => onChange(images.filter((_, at) => at !== index))}
					>
						×
					</button>
				</span>
			))}
			{error ? <p role="alert">{error}</p> : null}
			{preview ? (
				<div
					role="dialog"
					aria-label="图片 / Image"
					className="img-preview-backdrop"
					onClick={() => setPreview(undefined)}
				>
					<img src={imagePreviewUrl(preview)} alt={label} className="img-preview-full" />
					<button type="button" onClick={() => setPreview(undefined)}>
						关闭 / Close
					</button>
				</div>
			) : null}
		</div>
	);
}
