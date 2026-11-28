// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CenteredDiv } from "@/app/element/quickelems";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { formatRemoteUri } from "@/util/waveutil";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../../i18n";
import { base64ToBytes, formatHexDump } from "./preview-hex";
import type { SpecializedViewProps } from "./preview";
import { MaxBinaryPreviewBytes } from "./preview-type";

type BinaryPreviewState =
    | { status: "loading" }
    | { status: "ready"; bytes: Uint8Array }
    | { status: "error"; error: string };

function BinaryPreview({ model }: SpecializedViewProps) {
    const { t } = useI18n();
    const fileInfo = useAtomValue(model.statFile);
    const conn = useAtomValue(model.connection);
    const refreshVersion = useAtomValue(model.refreshVersion);
    const [state, setState] = useState<BinaryPreviewState>({ status: "loading" });
    const fileSize = fileInfo?.size ?? 0;

    useEffect(() => {
        model.refreshCallback = () => {
            globalStore.set(model.refreshVersion, (v) => v + 1);
        };
        return () => {
            model.refreshCallback = null;
        };
    }, []);

    useEffect(() => {
        if (!fileInfo || fileSize === 0) {
            setState({ status: "ready", bytes: new Uint8Array(0) });
            return;
        }
        let cancelled = false;
        async function loadPreview() {
            try {
                const path = formatRemoteUri(fileInfo.path, conn);
                const fileData = await model.env.rpc.FileReadCommand(TabRpcClient, {
                    info: { path },
                    at: { offset: 0, size: MaxBinaryPreviewBytes },
                });
                if (!cancelled) {
                    setState({ status: "ready", bytes: base64ToBytes(fileData?.data64) });
                }
            } catch (e) {
                if (!cancelled) {
                    setState({ status: "error", error: `${e}` });
                }
            }
        }
        setState({ status: "loading" });
        loadPreview();
        return () => {
            cancelled = true;
        };
    }, [fileInfo?.path, fileSize, conn, refreshVersion]);

    const hexDump = useMemo(() => {
        return state.status === "ready" ? formatHexDump(state.bytes) : "";
    }, [state]);

    if (state.status === "loading") {
        return <CenteredDiv>{t("preview.loading")}</CenteredDiv>;
    }
    if (state.status === "error") {
        return (
            <CenteredDiv>
                {t("preview.fileReadFailed")}: {state.error}
            </CenteredDiv>
        );
    }
    if (fileSize === 0) {
        return <CenteredDiv>{t("preview.binaryEmpty")}</CenteredDiv>;
    }
    if (state.bytes.length === 0) {
        return <CenteredDiv>{t("preview.binaryNoData")}</CenteredDiv>;
    }
    const shownBytes = state.bytes.length;
    const previewMessage =
        fileSize > shownBytes
            ? t("preview.binaryPreviewTruncated", {
                  shown: shownBytes,
                  total: fileSize,
                  limit: MaxBinaryPreviewBytes,
              })
            : t("preview.binaryPreview", { shown: shownBytes, total: fileSize });
    return (
        <div className="flex flex-col h-full w-full overflow-hidden p-[10px] gap-2">
            <div className="text-xs text-secondary shrink-0">{previewMessage}</div>
            <div className="grow overflow-auto">
                <pre className="m-0 font-mono text-[11px] leading-[15px] whitespace-pre select-text">{hexDump}</pre>
            </div>
        </div>
    );
}

export { BinaryPreview };
