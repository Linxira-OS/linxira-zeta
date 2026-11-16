import { useEffect, useState } from "react";
import type { ComputerFrame, ComputerStructureNode, ComputerObservationLease } from "@linxiraos/studio-protocol"
import type { StudioClient } from "@linxiraos/studio-contract";
import { computerCommand, type ComputerWorkspaceSource } from "./workspaceSource";
import { ImagePreview } from "../composer/ImagePreview";
import { surfaceWindow, useSurfaceChrome, useSurfaceDocument } from "../dock/SurfaceContext";
import { Icon } from "../icons";
import { PREVIEW_COMPUTER_IMAGE } from "../preview/computerPreview";
import { frameTime, frameUnavailable } from "./presentation";
import type { ComputerExecutionTarget } from "./types";

export function ComputerFrameView({ frame, scopeSessionId, scopeKey, executionTarget, visible, viewportHeight, preview, zh, highlight, empty, client, source }: {
  frame: ComputerFrame | undefined; scopeSessionId: string; scopeKey: string; executionTarget: ComputerExecutionTarget;
  visible: boolean; viewportHeight: number; preview: boolean; zh: boolean; highlight?: ComputerStructureNode | undefined;
  empty: [string, string]; client: StudioClient; source: ComputerWorkspaceSource;
}) {
  const doc = useSurfaceDocument(), chrome = useSurfaceChrome();
  const [picture, setPicture] = useState<{ key: string; url: string; bytes?: Uint8Array }>();
  const [error, setError] = useState(""), [expanded, setExpanded] = useState(false), [pixelSize, setPixelSize] = useState(false);
  const [retry, setRetry] = useState(0), [expired, setExpired] = useState(false);
  const key = `${scopeKey}:${scopeSessionId}:${frame?.frameId ?? ""}`;
  const unavailable = expired ? (zh ? "观察画面已过期，请显式刷新获取新画面。" : "Observation frame expired. Refresh explicitly for a new frame.") : frame ? frameUnavailable(frame, zh) : undefined;
  useEffect(() => {
    setExpired(false);
    if (!frame || preview || frame.source !== "observation") return;
    const expiresAt = Math.min(frame.expiresAt ?? Infinity, Date.now() + 120000);
    const timer = setTimeout(() => setExpired(true), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [key, frame?.expiresAt, preview]);
  const channelReason = executionTarget.kind === "remote" ? (zh ? "此远端连接只提供画面元数据，未提供远端图像通道。不会读取本机屏幕。" : "This remote connection supplies metadata only, not remote images. Your local screen will not be read.")
    : executionTarget.kind !== "local" ? (zh ? "执行设备尚未确定，不能读取本机图像。" : "Execution device is unknown; local images cannot be read.")
    : !chrome?.readComputerFrame || !chrome?.adoptComputerView || !chrome?.releaseComputerView ? (zh ? "当前客户端没有私有图像通道，请使用支持此功能的桌面版。" : "This client has no private image channel. Use a compatible desktop app.") : undefined;
  useEffect(() => {
    let current = true, url: string | undefined;
    let ownedLease: ComputerObservationLease | undefined;
    let released = false;
    const release = () => {
      if (!ownedLease || released) return;
      released = true;
      const lease = ownedLease;
      void Promise.allSettled([
        computerCommand(client, "computer.observe.close", { sessionId: scopeSessionId, leaseId: lease.leaseId }),
        chrome?.releaseComputerView?.({ scopeSessionId, leaseId: lease.leaseId, origin: "local" }),
      ]);
    };
    setPicture(undefined); setError(""); setExpanded(false); setPixelSize(false);
    if (!frame || !visible || unavailable) return;
    if (preview) { setPicture({ key, url: PREVIEW_COMPUTER_IMAGE }); return; }
    if (channelReason) return;
    const win = surfaceWindow(doc);
    void (async () => {
      let leaseId: string;
      if (frame.source === "observation") leaseId = await source.observationLeaseId();
      else {
        ownedLease = await computerCommand(client, "computer.observe.open", { sessionId: scopeSessionId, consumerId: `frame-reader:${crypto.randomUUID()}` });
        if (!current) { release(); return; }
        leaseId = ownedLease.leaseId;
        const adopted = await chrome!.adoptComputerView!({ scopeSessionId, leaseId, origin: "local" });
        if (!adopted.ok) throw new Error(adopted.message);
      }
      if (!current) { release(); return; }
      const result = await chrome!.readComputerFrame!({ scopeSessionId, leaseId, frameId: frame.frameId, origin: "local" });
      if (!current) return;
      if (!result.ok) throw new Error(result.message);
      const bytes = new Uint8Array(result.data);
      url = win.URL.createObjectURL(new win.Blob([result.data], { type: result.mimeType }));
      setPicture({ key, url, bytes });
    })().catch(cause => { release(); if (current) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { current = false; release(); if (url) win.URL.revokeObjectURL(url); };
  }, [key, frame?.availability, unavailable, scopeSessionId, chrome, doc, visible, preview, channelReason, retry, client, source]);
  const image = picture?.key === key && visible ? picture : undefined;
  const failure = unavailable ?? (!preview ? channelReason : undefined) ?? (error || undefined);
  return <section className="cw-frame" aria-label={zh ? "目标画面" : "Target frame"} aria-busy={!!frame && visible && !image && !failure}>
    <div className="cw-frame-stage" data-pixels={pixelSize || undefined} style={{ minHeight: Math.min(viewportHeight, 220), maxHeight: viewportHeight }}>
      {image && !failure ? <div className="cw-image-box" style={{ aspectRatio: `${frame!.width} / ${frame!.height}`, maxWidth: `min(100%, ${Math.max(1, viewportHeight - 16) * frame!.width / frame!.height}px)`, ...(pixelSize ? { width: frame!.width, height: frame!.height, maxWidth: "none", maxHeight: "none" } : {}) }}>
        <img src={image.url} alt={zh ? "电脑目标截图" : "Computer target capture"} width={frame!.width} height={frame!.height} draggable={false} onError={() => setError(zh ? "图像无法解码，请重试读取这张画面。" : "Cannot decode this image. Retry reading the same frame.")} />
        {highlight?.bounds ? <span className="cw-highlight" aria-hidden="true" style={{ left: `${highlight.bounds.x / frame!.width * 100}%`, top: `${highlight.bounds.y / frame!.height * 100}%`, width: `${highlight.bounds.width / frame!.width * 100}%`, height: `${highlight.bounds.height / frame!.height * 100}%` }} /> : null}
      </div> : <div className="cw-empty"><Icon name={frame?.screenLocked ? "lock" : "monitor"} /><h3>{frame ? failure ? zh ? "画面暂不可用" : "Frame unavailable" : visible ? zh ? "正在读取画面" : "Reading frame" : zh ? "观察已暂停" : "Observation paused" : empty[0]}</h3><p>{frame ? failure ?? (visible ? zh ? "正在读取这张画面…" : "Reading this frame…" : zh ? "回到此视图后恢复画面显示。" : "Return to this view to display the frame.") : empty[1]}</p>{error && !unavailable && !channelReason ? <button className="cw-button" onClick={() => setRetry(value => value + 1)}>{zh ? "重试读取" : "Retry image"}</button> : null}</div>}
    </div>
    <footer className="cw-frame-footer">
      <div className="cw-frame-caption">{frame ? <><strong>{frame.source === "execution" ? zh ? "代理截图" : "Agent frame" : zh ? "观察画面" : "Observation frame"}</strong><span>{frame.targetName ?? frame.targetId}</span><time dateTime={new Date(frame.capturedAt).toISOString()}>{frameTime(frame.capturedAt, zh)}</time><span>{frame.width} × {frame.height}{frame.screenLocked ? zh ? " · 采集时已锁屏" : " · Locked at capture" : ""}</span>{frame.delivered ? <span>{zh ? "已包含在工具结果" : "Included in tool result"}</span> : <span>{zh ? "未包含在工具结果" : "Not included in tool result"}</span>}</> : <span>{zh ? "尚无画面 · 仅查看，不转发键鼠" : "No frame · View only, no input forwarding"}</span>}</div>
      <div className="cw-image-actions"><button className="cw-button" disabled={!image} aria-pressed={!pixelSize} onClick={() => setPixelSize(false)}>{zh ? "适应" : "Fit"}</button><button className="cw-button" disabled={!image} aria-pressed={pixelSize} data-tip={zh ? "截图原始像素，不代表屏幕全分辨率" : "Received image pixels, not full display resolution"} onClick={() => setPixelSize(true)}>100%</button><button className="cw-button" aria-label={zh ? "查看大图" : "Open image viewer"} disabled={!image || !!failure} onClick={() => setExpanded(true)}><Icon name="expand" /></button></div>
    </footer>
    {expanded && image && frame ? <ImagePreview image={{ url: image.url, label: frame.targetName ?? frame.frameId, mimeType: "image/png", ...(image.bytes ? { bytes: image.bytes } : {}) }} actionsEnabled={!preview} onClose={() => setExpanded(false)} onError={setError} /> : null}
  </section>;
}
