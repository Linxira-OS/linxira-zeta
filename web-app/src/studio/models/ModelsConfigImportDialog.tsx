import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../icons";
import { useI18n } from "../i18n";
import type { ModelsConfigDocument, ModelsConfigParseError } from "./modelsConfigDocument";
import { modelsConfigWriteText, parseModelsConfigDocument } from "./modelsConfigDocument";

export interface ModelsConfigImportDialogProps {
  readonly open: boolean;
  readonly busy: boolean;
  readonly onClose: () => void;
  /** Receives the validated document and the text the panel layer should store. */
  readonly onImport: (writeText: string, document: ModelsConfigDocument) => void | Promise<void>;
}

/**
 * Whole-document import for the provider panel.
 *
 * The dialog owns parsing so a malformed paste never reaches the Host: it
 * accepts the two encodings the CLI accepts (block-style YAML and standard
 * JSON), shows typed validation errors with a path, and sends YAML unchanged
 * while converting JSON to the `.yml` block form the panel layer stores.
 */
export function ModelsConfigImportDialog({ open, busy, onClose, onImport }: ModelsConfigImportDialogProps) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [parseError, setParseError] = useState<ModelsConfigParseError | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const titleId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const localBusy = busy || submitting;

  useEffect(() => {
    if (!open) return;
    setText("");
    setParseError(null);
    setHostError(null);
    setSubmitting(false);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !localBusy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [localBusy, onClose, open]);

  if (!open) return null;

  const submit = async () => {
    if (localBusy) return;
    setHostError(null);
    const parsed = parseModelsConfigDocument(text);
    if (!parsed.ok) {
      setParseError(parsed.error);
      return;
    }
    setParseError(null);
    setSubmitting(true);
    try {
      await onImport(modelsConfigWriteText(parsed), parsed.document);
      onClose();
    } catch (error) {
      setHostError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={() => { if (!localBusy) onClose(); }}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ width: 720, maxWidth: "calc(100vw - 32px)" }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head" id={titleId}>{t("modelConfig.importConfigTitle")}</div>
        <div className="modal-body">
          <p className="small muted">{t("modelConfig.importConfigDesc")}</p>
          <textarea
            ref={textareaRef}
            className="input mono"
            style={{ width: "100%", minHeight: 280, resize: "vertical" }}
            spellCheck={false}
            value={text}
            placeholder={t("modelConfig.importConfigPlaceholder")}
            aria-label={t("modelConfig.importConfigTitle")}
            aria-invalid={parseError !== null || hostError !== null}
            onChange={(event) => { setText(event.target.value); setParseError(null); setHostError(null); }}
          />
          {parseError ? (
            <p className="small" role="alert" data-error-code={parseError.code}>
              {t("modelConfig.importConfigInvalid", { message: parseError.message })}
              {parseError.path ? ` · ${parseError.path}` : ""}
            </p>
          ) : null}
          {hostError ? <p className="small" role="alert">{hostError}</p> : null}
          <p className="small muted">{t("modelConfig.importConfigFormats")}</p>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn outline" disabled={localBusy} onClick={onClose}>{t("common.cancel")}</button>
          <button type="button" className="btn primary" disabled={localBusy || text.trim() === ""} onClick={() => void submit()}>
            <Icon name="check" extra="sm" />
            {localBusy ? t("modelConfig.importConfigApplying") : t("modelConfig.importConfigApply")}
          </button>
        </div>
      </div>
    </div>
  );
}
