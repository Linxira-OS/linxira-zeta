// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { createBlock } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import type { TabModel } from "@/app/store/tab-model";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getOverrideConfigAtom, refocusNode } from "@/store/global";
import * as WOS from "@/store/wos";
import { t } from "../../../i18n";
import { goHistory, goHistoryBack, goHistoryForward } from "@/util/historyutil";
import { checkKeyPressed } from "@/util/keyutil";
import { addOpenMenuItems } from "@/util/previewutil";
import { base64ToString, fireAndForget, isBlank, jotaiLoadableValue, stringToBase64 } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import clsx from "clsx";
import { Atom, atom, Getter, PrimitiveAtom, WritableAtom } from "jotai";
import { loadable } from "jotai/utils";
import type * as MonacoTypes from "monaco-editor";
import { createRef } from "react";
import { PreviewView } from "./preview";
import { makeDirectoryDefaultMenuItems } from "./preview-directory-utils";
import { buildZetaIdeBlockDef } from "./preview-handoff";
import { classifyPreview, isFileReadOnly, isMarkdownLike } from "./preview-type";
import type { PreviewEnv } from "./previewenv";

// TODO drive this using config
const BOOKMARKS: { label: string; path: string }[] = [
    { label: t("preview.bookmark.home"), path: "~" },
    { label: t("preview.bookmark.desktop"), path: "~/Desktop" },
    { label: t("preview.bookmark.downloads"), path: "~/Downloads" },
    { label: t("preview.bookmark.documents"), path: "~/Documents" },
    { label: t("preview.bookmark.root"), path: "/" },
];

function iconForFile(mimeType: string): string {
    if (mimeType == null) {
        mimeType = "unknown";
    }
    if (mimeType == "application/pdf") {
        return "file-pdf";
    } else if (mimeType.startsWith("image/")) {
        return "image";
    } else if (mimeType.startsWith("video/")) {
        return "film";
    } else if (mimeType.startsWith("audio/")) {
        return "headphones";
    } else if (isMarkdownLike(mimeType)) {
        return "file-lines";
    } else if (mimeType == "text/csv") {
        return "file-csv";
    } else if (
        mimeType.startsWith("text/") ||
        mimeType == "application/sql" ||
        (mimeType.startsWith("application/") &&
            (mimeType.includes("json") || mimeType.includes("yaml") || mimeType.includes("toml")))
    ) {
        return "file-code";
    } else {
        return "file";
    }
}

export class PreviewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    noPadding?: Atom<boolean>;
    blockAtom: Atom<Block>;
    viewIcon: Atom<string | IconButtonDecl>;
    viewName: Atom<string>;
    viewText: Atom<HeaderElem[]>;
    preIconButton: Atom<IconButtonDecl>;
    endIconButtons: Atom<IconButtonDecl[]>;
    hideViewName: Atom<boolean>;
    previewTextRef: React.RefObject<HTMLDivElement>;
    editMode: Atom<boolean>;
    canPreview: PrimitiveAtom<boolean>;
    specializedView: Atom<Promise<{ specializedView?: string; errorStr?: string }>>;
    loadableSpecializedView: Atom<Loadable<{ specializedView?: string; errorStr?: string }>>;
    manageConnection: Atom<boolean>;
    connStatus: Atom<ConnStatus>;
    filterOutNowsh?: Atom<boolean>;

    metaFilePath: Atom<string>;
    statFilePath: Atom<Promise<string>>;
    loadableFileInfo: Atom<Loadable<FileInfo>>;
    connection: Atom<Promise<string>>;
    connectionImmediate: Atom<string>;
    statFile: Atom<Promise<FileInfo>>;
    fullFile: Atom<Promise<FileData>>;
    fileMimeType: Atom<Promise<string>>;
    fileMimeTypeLoadable: Atom<Loadable<string>>;
    fileContentSaved: PrimitiveAtom<string | null>;
    fileContent: WritableAtom<Promise<string>, [string], void>;
    newFileContent: PrimitiveAtom<string | null>;
    connectionError: PrimitiveAtom<string>;
    errorMsgAtom: PrimitiveAtom<ErrorMsg>;

    openFileModal: PrimitiveAtom<boolean>;
    openFileModalDelay: PrimitiveAtom<boolean>;
    openFileError: PrimitiveAtom<string>;
    openFileModalGiveFocusRef: React.RefObject<() => boolean>;

    markdownShowToc: PrimitiveAtom<boolean>;

    monacoRef: React.RefObject<MonacoTypes.editor.IStandaloneCodeEditor>;

    showHiddenFiles: PrimitiveAtom<boolean>;
    refreshVersion: PrimitiveAtom<number>;
    directorySearchActive: PrimitiveAtom<boolean>;
    refreshCallback: () => void;
    directoryKeyDownHandler: (waveEvent: WaveKeyboardEvent) => boolean;
    codeEditKeyDownHandler: (waveEvent: WaveKeyboardEvent) => boolean;
    env: PreviewEnv;

    constructor({ blockId, nodeModel, tabModel, waveEnv }: ViewModelInitType) {
        this.viewType = "preview";
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.env = waveEnv;
        let showHiddenFiles = globalStore.get(this.env.getSettingsKeyAtom("preview:showhiddenfiles")) ?? true;
        this.showHiddenFiles = atom<boolean>(showHiddenFiles);
        this.refreshVersion = atom(0);
        this.directorySearchActive = atom(false);
        this.previewTextRef = createRef();
        this.openFileModal = atom(false);
        this.openFileModalDelay = atom(false);
        this.openFileError = atom(null) as PrimitiveAtom<string>;
        this.openFileModalGiveFocusRef = createRef();
        this.manageConnection = atom(true);
        this.blockAtom = this.env.wos.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.markdownShowToc = atom(false);
        this.filterOutNowsh = atom(true);
        this.monacoRef = createRef();
        this.connectionError = atom("");
        this.errorMsgAtom = atom(null) as PrimitiveAtom<ErrorMsg | null>;
        this.viewIcon = atom((get) => {
            const blockData = get(this.blockAtom);
            if (blockData?.meta?.icon) {
                return blockData.meta.icon;
            }
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return null;
            }
            const mimeTypeLoadable = get(this.fileMimeTypeLoadable);
            const mimeType = jotaiLoadableValue(mimeTypeLoadable, "");
            if (mimeType == "directory") {
                return {
                    elemtype: "iconbutton",
                    icon: "folder-open",
                    longClick: (e: React.MouseEvent<any>) => {
                        const menuItems: ContextMenuItem[] = BOOKMARKS.map((bookmark) => ({
                            label: t("preview.goToBookmark", { label: bookmark.label, path: bookmark.path }),
                            click: () => this.goHistory(bookmark.path),
                        }));
                        ContextMenuModel.getInstance().showContextMenu(menuItems, e);
                    },
                };
            }
            return iconForFile(mimeType);
        });
        this.editMode = atom((get) => {
            const blockData = get(this.blockAtom);
            return blockData?.meta?.edit ?? false;
        });
        this.viewName = atom(t("preview.title"));
        this.hideViewName = atom(true);
        this.viewText = atom((get) => {
            let headerPath = get(this.metaFilePath);
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return [
                    {
                        elemtype: "text",
                        text: headerPath,
                        className: "preview-filename",
                    },
                ];
            }
            const loadableSV = get(this.loadableSpecializedView);
            const isCeView = loadableSV.state == "hasData" && loadableSV.data.specializedView == "codeedit";
            const loadableFileInfo = get(this.loadableFileInfo);
            if (loadableFileInfo.state == "hasData") {
                headerPath = loadableFileInfo.data?.path;
                if (headerPath == "~") {
                    headerPath = `~ (${loadableFileInfo.data?.dir + "/" + loadableFileInfo.data?.name})`;
                }
            }
            if (!isBlank(headerPath) && headerPath != "/" && headerPath.endsWith("/")) {
                headerPath = headerPath.slice(0, -1);
            }
            const viewTextChildren: HeaderElem[] = [
                {
                    elemtype: "text",
                    text: headerPath,
                    ref: this.previewTextRef,
                    className: "preview-filename",
                    onClick: () => this.toggleOpenFileModal(),
                },
            ];
            let saveClassName = "grey";
            if (get(this.newFileContent) !== null) {
                saveClassName = "green";
            }
            if (isCeView) {
                const fileInfo = globalStore.get(this.loadableFileInfo);
                if (fileInfo.state != "hasData") {
                    viewTextChildren.push({
                        elemtype: "textbutton",
                        text: t("preview.loading"),
                        className: clsx(`grey rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]`),
                        onClick: () => {},
                    });
                } else if (fileInfo.data.readonly) {
                    viewTextChildren.push({
                        elemtype: "textbutton",
                        text: t("preview.readOnly"),
                        className: clsx(`yellow rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]`),
                        onClick: () => {},
                    });
                } else {
                    viewTextChildren.push({
                        elemtype: "textbutton",
                        text: t("preview.save"),
                        className: clsx(`${saveClassName} rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]`),
                        onClick: () => fireAndForget(this.handleFileSave.bind(this)),
                    });
                }
                if (get(this.canPreview)) {
                    viewTextChildren.push({
                        elemtype: "textbutton",
                        text: t("preview.title"),
                        className: "grey rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]",
                        onClick: () => fireAndForget(() => this.setEditMode(false)),
                    });
                }
            } else if (get(this.canPreview)) {
                viewTextChildren.push({
                    elemtype: "textbutton",
                    text: t("preview.edit"),
                    className: "grey rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]",
                    onClick: () => fireAndForget(() => this.setEditMode(true)),
                });
            }
            return [
                {
                    elemtype: "div",
                    children: viewTextChildren,
                },
            ] as HeaderElem[];
        });
        this.preIconButton = atom((get) => {
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return null;
            }
            const mimeType = jotaiLoadableValue(get(this.fileMimeTypeLoadable), "");
            const metaPath = get(this.metaFilePath);
            if (mimeType == "directory" && metaPath == "/") {
                return null;
            }
            return {
                elemtype: "iconbutton",
                icon: "chevron-left",
                click: this.goParentDirectory.bind(this),
            };
        });
        this.endIconButtons = atom((get) => {
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return null;
            }
            const mimeType = jotaiLoadableValue(get(this.fileMimeTypeLoadable), "");
            const loadableSV = get(this.loadableSpecializedView);
            const isCeView = loadableSV.state == "hasData" && loadableSV.data.specializedView == "codeedit";
            if (mimeType == "directory") {
                const showHiddenFiles = get(this.showHiddenFiles);
                return [
                    {
                        elemtype: "iconbutton",
                        icon: showHiddenFiles ? "eye" : "eye-slash",
                        title: showHiddenFiles ? t("preview.hideHiddenFiles") : t("preview.showHiddenFiles"),
                        click: () => {
                            globalStore.set(this.showHiddenFiles, (prev) => !prev);
                        },
                    },
                    {
                        elemtype: "iconbutton",
                        icon: "arrows-rotate",
                        click: () => this.refreshCallback?.(),
                    },
                ] as IconButtonDecl[];
            } else if (!isCeView && isMarkdownLike(mimeType)) {
                return [
                    {
                        elemtype: "iconbutton",
                        icon: "book",
                        title: t("element.tableOfContents"),
                        click: () => this.markdownShowTocToggle(),
                    },
                    {
                        elemtype: "iconbutton",
                        icon: "arrows-rotate",
                        title: t("preview.refresh"),
                        click: () => this.refreshCallback?.(),
                    },
                ] as IconButtonDecl[];
            } else if (!isCeView && mimeType) {
                // For all other file types (text, code, etc.), add refresh button
                return [
                    {
                        elemtype: "iconbutton",
                        icon: "arrows-rotate",
                        title: t("preview.refresh"),
                        click: () => this.refreshCallback?.(),
                    },
                ] as IconButtonDecl[];
            }
            return null;
        });
        this.metaFilePath = atom<string>((get) => {
            const file = get(this.blockAtom)?.meta?.file;
            if (isBlank(file)) {
                return "~";
            }
            return file;
        });
        this.statFilePath = atom<Promise<string>>(async (get) => {
            const fileInfo = await get(this.statFile);
            return fileInfo?.path;
        });
        this.connection = atom<Promise<string>>(async (get) => {
            const connName = get(this.blockAtom)?.meta?.connection;
            try {
                await this.env.rpc.ConnEnsureCommand(TabRpcClient, { connname: connName }, { timeout: 60000 });
                globalStore.set(this.connectionError, "");
            } catch (e) {
                globalStore.set(this.connectionError, e as string);
            }
            return connName;
        });
        this.connectionImmediate = atom<string>((get) => {
            return get(this.blockAtom)?.meta?.connection;
        });
        this.statFile = atom<Promise<FileInfo>>(async (get) => {
            const fileName = get(this.metaFilePath);
            const path = await this.formatRemoteUri(fileName, get);
            if (fileName == null) {
                return null;
            }
            try {
                const statFile = await this.env.rpc.FileInfoCommand(TabRpcClient, {
                    info: {
                        path,
                    },
                });
                return statFile;
            } catch (e) {
                const errorStatus: ErrorMsg = {
                    status: t("preview.fileReadFailed"),
                    text: `${e}`,
                };
                globalStore.set(this.errorMsgAtom, errorStatus);
            }
        });
        this.fileMimeType = atom<Promise<string>>(async (get) => {
            const fileInfo = await get(this.statFile);
            return fileInfo?.mimetype;
        });
        this.fileMimeTypeLoadable = loadable(this.fileMimeType);
        this.newFileContent = atom(null) as PrimitiveAtom<string | null>;
        this.goParentDirectory = this.goParentDirectory.bind(this);

        const fullFileAtom = atom<Promise<FileData>>(async (get) => {
            get(this.refreshVersion); // Subscribe to refreshVersion to trigger re-fetch
            const fileName = get(this.metaFilePath);
            const path = await this.formatRemoteUri(fileName, get);
            if (fileName == null) {
                return null;
            }
            try {
                const file = await this.env.rpc.FileReadCommand(TabRpcClient, {
                    info: {
                        path,
                    },
                });
                return file;
            } catch (e) {
                const errorStatus: ErrorMsg = {
                    status: t("preview.fileReadFailed"),
                    text: `${e}`,
                };
                globalStore.set(this.errorMsgAtom, errorStatus);
            }
        });

        this.fileContentSaved = atom(null) as PrimitiveAtom<string | null>;
        const fileContentAtom = atom(
            async (get) => {
                const newContent = get(this.newFileContent);
                if (newContent != null) {
                    return newContent;
                }
                const savedContent = get(this.fileContentSaved);
                if (savedContent != null) {
                    return savedContent;
                }
                const fullFile = await get(fullFileAtom);
                return base64ToString(fullFile?.data64);
            },
            (_, set, update: string) => {
                set(this.fileContentSaved, update);
            }
        );

        this.fullFile = fullFileAtom;
        this.fileContent = fileContentAtom;

        this.specializedView = atom<Promise<{ specializedView?: string; errorStr?: string }>>(async (get) => {
            return this.getSpecializedView(get);
        });
        this.loadableSpecializedView = loadable(this.specializedView);
        this.canPreview = atom(false);
        this.loadableFileInfo = loadable(this.statFile);
        this.connStatus = atom((get) => {
            const blockData = get(this.blockAtom);
            const connName = blockData?.meta?.connection;
            const connAtom = this.env.getConnStatusAtom(connName);
            return get(connAtom);
        });

        this.noPadding = atom(true);
    }

    markdownShowTocToggle() {
        globalStore.set(this.markdownShowToc, !globalStore.get(this.markdownShowToc));
    }

    get viewComponent(): ViewComponent {
        return PreviewView;
    }

    async getSpecializedView(getFn: Getter): Promise<{ specializedView?: string; errorStr?: string }> {
        const mimeType = await getFn(this.fileMimeType);
        const fileInfo = await getFn(this.statFile);
        const connErr = getFn(this.connectionError);
        const editMode = getFn(this.editMode);
        const genErr = getFn(this.errorMsgAtom);

        if (!fileInfo) {
            return { errorStr: t("preview.loadError", { error: genErr?.text }) };
        }
        if (connErr != "") {
            return { errorStr: t("preview.connectionError", { error: connErr }) };
        }
        if (fileInfo.notfound) {
            return { specializedView: "codeedit" };
        }
        const classification = classifyPreview(mimeType, fileInfo.size, editMode);
        if (classification.kind === "view") {
            return { specializedView: classification.view };
        }
        if (classification.error === "file-too-large") {
            return { errorStr: t("preview.fileTooLarge") };
        }
        if (classification.error === "csv-too-large") {
            return { errorStr: t("preview.csvTooLarge") };
        }
        return { errorStr: `Preview (${mimeType})` };
    }

    updateOpenFileModalAndError(isOpen, errorMsg = null) {
        globalStore.set(this.openFileModal, isOpen);
        globalStore.set(this.openFileError, errorMsg);
        if (isOpen) {
            globalStore.set(this.openFileModalDelay, true);
        } else {
            const delayVal = globalStore.get(this.openFileModalDelay);
            if (delayVal) {
                setTimeout(() => {
                    globalStore.set(this.openFileModalDelay, false);
                }, 200);
            }
        }
    }

    toggleOpenFileModal() {
        const modalOpen = globalStore.get(this.openFileModal);
        const delayVal = globalStore.get(this.openFileModalDelay);
        if (!modalOpen && delayVal) {
            return;
        }
        this.updateOpenFileModalAndError(!modalOpen);
    }

    async goHistory(newPath: string) {
        let fileName = globalStore.get(this.metaFilePath);
        if (fileName == null) {
            fileName = "";
        }
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const updateMeta = goHistory("file", fileName, newPath, blockMeta);
        if (updateMeta == null) {
            return;
        }
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, updateMeta);

        // Clear the saved file buffers
        globalStore.set(this.fileContentSaved, null);
        globalStore.set(this.newFileContent, null);
    }

    async goParentDirectory({ fileInfo = null }: { fileInfo?: FileInfo | null }) {
        // optional parameter needed for recursive case
        const defaultFileInfo = await globalStore.get(this.statFile);
        if (fileInfo === null) {
            fileInfo = defaultFileInfo;
        }
        if (fileInfo == null) {
            this.updateOpenFileModalAndError(false);
            return true;
        }
        try {
            this.updateOpenFileModalAndError(false);
            await this.goHistory(fileInfo.dir);
            refocusNode(this.blockId);
        } catch (e) {
            globalStore.set(this.openFileError, e.message);
            console.error("Error opening file", fileInfo.dir, e);
        }
    }

    async goHistoryBack() {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const curPath = globalStore.get(this.metaFilePath);
        const updateMeta = goHistoryBack("file", curPath, blockMeta, true);
        if (updateMeta == null) {
            return;
        }
        updateMeta.edit = false;
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, updateMeta);
    }

    async goHistoryForward() {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const curPath = globalStore.get(this.metaFilePath);
        const updateMeta = goHistoryForward("file", curPath, blockMeta);
        if (updateMeta == null) {
            return;
        }
        updateMeta.edit = false;
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, updateMeta);
    }

    async setEditMode(edit: boolean) {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const blockOref = WOS.makeORef("block", this.blockId);
        await this.env.services.object.UpdateObjectMeta(blockOref, { ...blockMeta, edit });
    }

    async handleFileSave() {
        const newFileContent = globalStore.get(this.newFileContent);
        if (newFileContent == null) {
            console.log("not saving file, newFileContent is null");
            return;
        }
        const fileInfo = await globalStore.get(this.statFile);
        if (isFileReadOnly(fileInfo)) {
            globalStore.set(this.errorMsgAtom, {
                status: t("preview.readOnly"),
                text: t("preview.readOnlyNoSave"),
            });
            return;
        }
        const filePath = fileInfo?.path;
        if (filePath == null) {
            return;
        }
        try {
            await this.env.rpc.FileWriteCommand(TabRpcClient, {
                info: {
                    path: await this.formatRemoteUri(filePath, globalStore.get),
                },
                data64: stringToBase64(newFileContent),
            });
            globalStore.set(this.fileContent, newFileContent);
            globalStore.set(this.newFileContent, null);
            console.log("saved file", filePath);
        } catch (e) {
            const errorStatus: ErrorMsg = {
                status: t("preview.saveFailed"),
                text: `${e}`,
            };
            globalStore.set(this.errorMsgAtom, errorStatus);
        }
    }

    async handleFileRevert() {
        const fileContent = await globalStore.get(this.fileContent);
        this.monacoRef.current?.setValue(fileContent);
        globalStore.set(this.newFileContent, null);
    }

    async openInZetaIde() {
        const fileInfo = await globalStore.get(this.statFile);
        const blockDef = buildZetaIdeBlockDef(fileInfo);
        if (blockDef == null) {
            return;
        }
        try {
            await createBlock(blockDef);
        } catch (e) {
            globalStore.set(this.errorMsgAtom, {
                status: t("preview.openInZetaIdeFailed"),
                text: `${e}`,
            });
        }
    }

    async handleOpenFile(filePath: string) {
        const fileInfo = await globalStore.get(this.statFile);
        this.updateOpenFileModalAndError(false);
        if (fileInfo == null) {
            return true;
        }
        try {
            this.goHistory(filePath);
            refocusNode(this.blockId);
        } catch (e) {
            globalStore.set(this.openFileError, e.message);
            console.error("Error opening file", filePath, e);
        }
    }

    isSpecializedView(sv: string): boolean {
        const loadableSV = globalStore.get(this.loadableSpecializedView);
        return loadableSV.state == "hasData" && loadableSV.data.specializedView == sv;
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const defaultFontSize = globalStore.get(this.env.getSettingsKeyAtom("editor:fontsize")) ?? 12;
        const blockData = globalStore.get(this.blockAtom);
        const overrideFontSize = blockData?.meta?.["editor:fontsize"];
        const menuItems: ContextMenuItem[] = [];
        menuItems.push({
            label: t("preview.copyFullPath"),
            click: () =>
                fireAndForget(async () => {
                    const filePath = await globalStore.get(this.statFilePath);
                    if (filePath == null) {
                        return;
                    }
                    const conn = await globalStore.get(this.connection);
                    if (conn) {
                        // remote path
                        await navigator.clipboard.writeText(formatRemoteUri(filePath, conn));
                    } else {
                        // local path
                        await navigator.clipboard.writeText(filePath);
                    }
                }),
        });
        menuItems.push({
            label: t("preview.copyFileName"),
            click: () =>
                fireAndForget(async () => {
                    const fileInfo = await globalStore.get(this.statFile);
                    if (fileInfo == null || fileInfo.name == null) {
                        return;
                    }
                    await navigator.clipboard.writeText(fileInfo.name);
                }),
        });
        menuItems.push({ type: "separator" });
        const finfo = jotaiLoadableValue(globalStore.get(this.loadableFileInfo), null);
        addOpenMenuItems(menuItems, globalStore.get(this.connectionImmediate), finfo);
        if (finfo && !finfo.isdir && isBlank(globalStore.get(this.connectionImmediate))) {
            // zetaide ships with the local Zeta install; a remote preview's
            // connection may not have it on PATH, so the handoff is local-only.
            menuItems.push({
                label: t("preview.openInZetaIde"),
                click: () => fireAndForget(this.openInZetaIde.bind(this)),
            });
        }
        const loadableSV = globalStore.get(this.loadableSpecializedView);
        const wordWrapAtom = getOverrideConfigAtom(this.blockId, "editor:wordwrap");
        const wordWrap = globalStore.get(wordWrapAtom) ?? false;
        menuItems.push({ type: "separator" });
        if (loadableSV.state == "hasData" && loadableSV.data.specializedView == "codeedit") {
            const fontSizeSubMenu: ContextMenuItem[] = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(
                (fontSize: number) => {
                    return {
                        label: fontSize.toString() + "px",
                        type: "checkbox",
                        checked: overrideFontSize == fontSize,
                        click: () => {
                            this.env.rpc.SetMetaCommand(TabRpcClient, {
                                oref: WOS.makeORef("block", this.blockId),
                                meta: { "editor:fontsize": fontSize },
                            });
                        },
                    };
                }
            );
            fontSizeSubMenu.unshift({
                label: t("preview.defaultFontSize", { size: defaultFontSize }),
                type: "checkbox",
                checked: overrideFontSize == null,
                click: () => {
                    this.env.rpc.SetMetaCommand(TabRpcClient, {
                        oref: WOS.makeORef("block", this.blockId),
                        meta: { "editor:fontsize": null },
                    });
                },
            });
            menuItems.push({
                label: t("preview.editorFontSize"),
                submenu: fontSizeSubMenu,
            });
            if (globalStore.get(this.newFileContent) != null) {
                menuItems.push({ type: "separator" });
                menuItems.push({
                    label: t("preview.saveFile"),
                    click: () => fireAndForget(this.handleFileSave.bind(this)),
                });
                menuItems.push({
                    label: t("preview.revertFile"),
                    click: () => fireAndForget(this.handleFileRevert.bind(this)),
                });
            }
            menuItems.push({ type: "separator" });
            menuItems.push({
                label: t("preview.wordWrap"),
                type: "checkbox",
                checked: wordWrap,
                click: () =>
                    fireAndForget(async () => {
                        const blockOref = WOS.makeORef("block", this.blockId);
                        await this.env.services.object.UpdateObjectMeta(blockOref, {
                            "editor:wordwrap": !wordWrap,
                        });
                    }),
            });
        }
        if (loadableSV.state == "hasData" && loadableSV.data.specializedView == "directory") {
            menuItems.push({ type: "separator" });
            menuItems.push({ label: t("preview.defaultSettings"), enabled: false });
            menuItems.push(...makeDirectoryDefaultMenuItems(this));
        }
        return menuItems;
    }

    giveFocus(): boolean {
        const openModalOpen = globalStore.get(this.openFileModal);
        if (openModalOpen) {
            this.openFileModalGiveFocusRef.current?.();
            return true;
        }
        if (this.monacoRef.current) {
            this.monacoRef.current.focus();
            return true;
        }
        return false;
    }

    keyDownHandler(e: WaveKeyboardEvent): boolean {
        if (checkKeyPressed(e, "Cmd:ArrowLeft")) {
            fireAndForget(this.goHistoryBack.bind(this));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:ArrowRight")) {
            fireAndForget(this.goHistoryForward.bind(this));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:ArrowUp")) {
            // handle up directory
            fireAndForget(() => this.goParentDirectory({}));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:o")) {
            this.toggleOpenFileModal();
            return true;
        }
        const canPreview = globalStore.get(this.canPreview);
        if (canPreview) {
            if (checkKeyPressed(e, "Cmd:e")) {
                const editMode = globalStore.get(this.editMode);
                fireAndForget(() => this.setEditMode(!editMode));
                return true;
            }
        }
        if (this.directoryKeyDownHandler) {
            const handled = this.directoryKeyDownHandler(e);
            if (handled) {
                return true;
            }
        }
        if (this.codeEditKeyDownHandler) {
            const handled = this.codeEditKeyDownHandler(e);
            if (handled) {
                return true;
            }
        }
        return false;
    }

    async formatRemoteUri(path: string, get: Getter): Promise<string> {
        return formatRemoteUri(path, await get(this.connection));
    }
}
