import { previewOfficeState, subscribePreviewOffice, setPreviewOfficeInstalled } from "../preview/filesPreview";
import { useEffect, useState } from "react";
import { AppSelect } from "../AppSelect";
import { useI18n } from "../i18n";
import { SettingRow, SettingSection } from "../settings/SettingRow";
import { usePreviewMode } from "../preview/PreviewContext";
import { readFileScope, saveFileScope, type FileScope } from "./filePreferences";
import type { OfficeComponentState } from "./file-viewer-shared"

export function FileViewerSettings() {
  const { resolvedLanguage } = useI18n();
  const zh = resolvedLanguage === "zh";
  const { preview } = usePreviewMode(); const [scope, setScope] = useState(() => readFileScope(preview));
  useEffect(() => setScope(readFileScope(preview)), [preview]);
  return <SettingSection title={zh ? "文件查看器" : "File Viewer"}><SettingRow label={zh ? "文件窗口默认归属" : "Default file window scope"} desc={zh ? "适用于之后打开的文件。已有窗口可通过 Pin 菜单调整归属。" : "Applies to newly opened files. Existing windows can be reassigned from their Pin menu."} source="user"><AppSelect aria-label={zh ? "文件窗口默认归属" : "Default file window scope"} value={scope} onChange={event => { const value = event.target.value as FileScope; setScope(value); saveFileScope(value, preview); }}><option value="conversation">{zh ? "跟随来源对话" : "Follow source conversation"}</option><option value="workspace">{zh ? "工作区共享" : "Workspace shared"}</option></AppSelect></SettingRow><SettingRow label={zh ? "保存方式" : "Save behavior"} desc={zh ? "Ctrl / Cmd + S 手动保存。磁盘文件被 Agent 或其他程序修改时提示处理冲突。" : "Manual save via Ctrl / Cmd + S. Prompts on disk conflicts caused by the agent or other programs."} source="default"><span>{zh ? "手动保存" : "Manual save"}</span></SettingRow></SettingSection>;
}
export function OfficeComponentSettings() {
  const { resolvedLanguage } = useI18n();
  const zh = resolvedLanguage === "zh";
  const { preview, marks } = usePreviewMode();
  const [state, setState] = useState<OfficeComponentState>({ id: "office-preview", status: "not-installed" });
  const api = globalThis.zetaStudioChrome?.files;
  const [error, setError] = useState("");
  useEffect(() => {
    if (preview) { setState(previewOfficeState()); return subscribePreviewOffice(() => setState(previewOfficeState())); }
    if (!api?.officeState || !api.onOfficeState) return;
    let active = true;
    void api.officeState().then(value => { if (active) setState(value); }).catch(error => { if (active) setError(String(error)); });
    const off = api.onOfficeState(setState); return () => { active = false; off(); };
  }, [preview, api]);
  const run = async (action: "check" | "install" | "uninstall" | "cancel") => {
    setError("");
    if (preview) { if (action === "install") setPreviewOfficeInstalled(true); else if (action === "uninstall") setPreviewOfficeInstalled(false); setState(previewOfficeState()); return; }
    try { const next = action === "check" ? await api?.officeState?.(true) : action === "install" ? await api?.officeInstall?.() : action === "uninstall" ? await api?.officeUninstall?.() : await api?.officeCancel?.(); if (next) setState(next); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  const busy = ["checking", "downloading", "installing"].includes(state.status);
  const available = preview || !!(api?.officeState && api.officeInstall && api.officeUninstall && api.officeCancel && api.onOfficeState);
  return <SettingSection title={`可选组件${preview && marks ? " · 演示" : ""}`}><SettingRow label="Office 文档预览" desc="通过 LibreOffice 在本机预览 Word、PowerPoint、ODT、ODP 和 RTF。默认不安装、不随主程序打包；Excel / CSV 已内置支持。" source={available ? "user" : "unavailable"} {...(!available ? { reason: "当前宿主未提供受信的 Office 组件安装服务" } : {})}>
    <div className="file-component-controls"><span>{state.installedVersion ? `已安装 ${state.installedVersion}` : "未安装"}{state.availableVersion && state.availableVersion !== state.installedVersion ? ` · 可用版本 ${state.availableVersion}` : ""}</span>{state.downloadBytes ? <small>{(state.downloadBytes / 1024 / 1024).toFixed(0)} MiB 下载</small> : null}
      {state.status === "downloading" ? <progress max={state.downloadBytes} value={state.receivedBytes ?? 0} /> : null}<div>
        <button className="btn small outline" disabled={!available || busy} onClick={() => { void run("check"); }}>{zh ? "检查组件版本" : "Check version"}</button>
        <button className="btn small primary" disabled={!available || busy} onClick={() => { void run("install"); }}>{state.status === "installing" ? (zh ? "正在安装…" : "Installing…") : state.status === "checking" ? (zh ? "正在检查…" : "Checking…") : state.installedVersion ? (zh ? "更新组件" : "Update") : (zh ? "安装组件" : "Install")}</button>
        {busy ? <button className="btn small outline" onClick={() => { void run("cancel"); }}>{zh ? "取消" : "Cancel"}</button> : state.installedVersion ? <button className="btn small outline" onClick={() => { void run("uninstall"); }}>{zh ? "卸载" : "Uninstall"}</button> : null}
      </div>{state.message || error ? <small role="status">{error || state.message}</small> : null}
    </div>
  </SettingRow></SettingSection>;
}
