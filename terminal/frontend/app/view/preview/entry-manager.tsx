// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Input } from "@/app/element/input";
import { useI18n } from "../../../i18n";
import React, { memo, useState } from "react";

export enum EntryManagerType {
    NewFile = "New File",
    NewDirectory = "New Folder",
    EditName = "Rename",
}

export type EntryManagerOverlayProps = {
    forwardRef?: React.Ref<HTMLDivElement>;
    entryManagerType: EntryManagerType;
    startingValue?: string;
    onSave: (newValue: string) => void;
    onCancel?: () => void;
    style?: React.CSSProperties;
    getReferenceProps?: () => any;
};

export const EntryManagerOverlay = memo(
    ({
        entryManagerType,
        startingValue,
        onSave,
        onCancel,
        forwardRef,
        style,
        getReferenceProps,
    }: EntryManagerOverlayProps) => {
        const { t } = useI18n();
        const [value, setValue] = useState(startingValue);
        let typeLabel: string;
        if (entryManagerType === EntryManagerType.NewFile) {
            typeLabel = t("preview.dir.newFile");
        } else if (entryManagerType === EntryManagerType.NewDirectory) {
            typeLabel = t("preview.dir.newFolder");
        } else {
            typeLabel = t("preview.dir.rename");
        }
        return (
            <div className="entry-manager-overlay" ref={forwardRef} style={style} {...(getReferenceProps?.() ?? {})}>
                <div className="entry-manager-type">{typeLabel}</div>
                <div className="entry-manager-input">
                    <Input
                        value={value}
                        onChange={setValue}
                        autoFocus={true}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                e.stopPropagation();
                                onSave(value);
                            }
                        }}
                    />
                </div>
                <div className="entry-manager-buttons">
                    <Button className="py-[4px]" onClick={() => onSave(value)}>
                        {t("common.ok")}
                    </Button>
                    <Button className="py-[4px] red outlined" onClick={onCancel}>
                        {t("common.cancel")}
                    </Button>
                </div>
            </div>
        );
    }
);

EntryManagerOverlay.displayName = "EntryManagerOverlay";
