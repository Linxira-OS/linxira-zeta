"use client";

import { useEffect, useState, useCallback } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLanguage } from "@/hooks/useLanguage";
import { FolderIcon } from "./FileIcons";

interface DirectoryItem {
  name: string;
  path: string;
  modified?: string;
}

interface ApiResponse {
  currentPath: string;
  parentPath: string | null;
  homeDir: string;
  drives: string[];
  directories: DirectoryItem[];
  error?: string;
}

interface Props {
  open: boolean;
  initialPath?: string | null;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function FolderPickerModal({ open, initialPath, onSelect, onClose }: Props) {
  const { t } = useLanguage();
  const isMobile = useIsMobile();
  const [currentPath, setCurrentPath] = useState<string>("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  const [drives, setDrives] = useState<string[]>([]);
  const [directories, setDirectories] = useState<DirectoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedPath, setSelectedPath] = useState<string>("");
  const [filterQuery, setFilterQuery] = useState<string>("");

  // New folder creation state
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchDirectory = useCallback(async (pathQuery?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = pathQuery ? `/api/fs/directories?path=${encodeURIComponent(pathQuery)}` : "/api/fs/directories";
      const res = await fetch(url);
      const data = (await res.json()) as ApiResponse;
      if (!res.ok || data.error) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setCurrentPath(data.currentPath);
      setSelectedPath(data.currentPath);
      setParentPath(data.parentPath);
      setHomeDir(data.homeDir);
      setDrives(data.drives ?? []);
      setDirectories(data.directories ?? []);
      setFilterQuery("");
      setCreatingFolder(false);
      setNewFolderName("");
      setCreateError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void fetchDirectory(initialPath || undefined);
    }
  }, [open, initialPath, fetchDirectory]);

  // Handle native browser folder picker if available
  const handleNativePicker = async () => {
    if (typeof window !== "undefined" && "showDirectoryPicker" in window) {
      try {
        // @ts-expect-error - Web File System Access API
        const handle = await window.showDirectoryPicker();
        if (handle && handle.name) {
          // Attempt to validate path if possible
          void fetchDirectory(handle.name);
        }
      } catch {
        // User cancelled or unsupported
      }
    }
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name || !currentPath) return;
    setLoading(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/fs/directories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentPath: currentPath, folderName: name }),
      });
      const data = (await res.json()) as { success?: boolean; path?: string; error?: string };
      if (!res.ok || data.error || !data.path) {
        setCreateError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setCreatingFolder(false);
      setNewFolderName("");
      await fetchDirectory(data.path);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  // Split path for interactive breadcrumb navigation
  const isWin = currentPath.includes("\\") || currentPath.includes(":");
  const pathSeparator = isWin ? "\\" : "/";
  const rawSegments = currentPath.split(/[/\\]/).filter(Boolean);
  const breadcrumbs: { label: string; path: string }[] = [];

  if (isWin && rawSegments.length > 0) {
    let acc = rawSegments[0].endsWith(":") ? `${rawSegments[0]}\\` : rawSegments[0];
    breadcrumbs.push({ label: rawSegments[0], path: acc });
    for (let i = 1; i < rawSegments.length; i++) {
      acc = `${acc}${pathSeparator}${rawSegments[i]}`;
      breadcrumbs.push({ label: rawSegments[i], path: acc });
    }
  } else {
    let acc = "";
    for (let i = 0; i < rawSegments.length; i++) {
      acc = `${acc}/${rawSegments[i]}`;
      breadcrumbs.push({ label: rawSegments[i], path: acc });
    }
  }

  const filteredDirs = directories.filter((d) =>
    d.name.toLowerCase().includes(filterQuery.trim().toLowerCase())
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: isMobile ? "calc(100vw - 16px)" : 740,
          maxWidth: "calc(100vw - 16px)",
          height: isMobile ? "calc(100dvh - 16px)" : "75vh",
          maxHeight: "calc(100dvh - 16px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 12px 40px rgba(0,0,0,0.3)",
          overflow: "hidden",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FolderIcon size={18} />
            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-mono)" }}>
              {t("Select Target Directory", "选择目标文件夹")}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {typeof window !== "undefined" && "showDirectoryPicker" in window && (
              <button
                onClick={handleNativePicker}
                title="Open native OS folder dialog"
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  color: "var(--text)",
                  cursor: "pointer",
                }}
              >
                {t("OS Dialog", "系统原生弹窗")}
              </button>
            )}
            <button
              onClick={onClose}
              title="Close"
              style={{
                width: 26,
                height: 26,
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                borderRadius: 4,
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Shortcuts & Navigation Bar */}
        <div
          style={{
            padding: "8px 14px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            flexShrink: 0,
          }}
        >
          {/* Up to Parent */}
          <button
            onClick={() => parentPath && fetchDirectory(parentPath)}
            disabled={!parentPath || loading}
            title="Go to parent directory"
            style={{
              padding: "3px 8px",
              background: parentPath ? "var(--bg)" : "none",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: parentPath ? "var(--text)" : "var(--text-dim)",
              cursor: parentPath ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontFamily: "var(--font-mono)",
            }}
          >
            {t("↑ Up", "↑ 上级")}
          </button>

          {/* Home shortcut */}
          <button
            onClick={() => homeDir && fetchDirectory(homeDir)}
            disabled={loading}
            title={`Home directory (${homeDir})`}
            style={{
              padding: "3px 8px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--text)",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
            }}
          >
            {t("~ Home", "~ 主目录")}
          </button>

          {/* Drive shortcuts on Windows */}
          {drives.map((drive) => (
            <button
              key={drive}
              onClick={() => fetchDirectory(drive)}
              disabled={loading}
              style={{
                padding: "3px 8px",
                background: currentPath.toUpperCase().startsWith(drive.toUpperCase())
                  ? "var(--accent)"
                  : "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: currentPath.toUpperCase().startsWith(drive.toUpperCase())
                  ? "#fff"
                  : "var(--text)",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
              }}
            >
              {drive}
            </button>
          ))}
        </div>

        {/* Breadcrumb Path Bar */}
        <div
          style={{
            padding: "8px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            overflowX: "auto",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            background: "var(--bg)",
            flexShrink: 0,
          }}
        >
          {breadcrumbs.map((b, i) => (
            <div key={b.path} style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              <button
                onClick={() => fetchDirectory(b.path)}
                style={{
                  background: "none",
                  border: "none",
                  padding: "2px 4px",
                  borderRadius: 3,
                  color: i === breadcrumbs.length - 1 ? "var(--text)" : "var(--accent)",
                  fontWeight: i === breadcrumbs.length - 1 ? 700 : 400,
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "none";
                }}
              >
                {b.label}
              </button>
              {i < breadcrumbs.length - 1 && <span style={{ color: "var(--text-dim)" }}>/</span>}
            </div>
          ))}
        </div>

        {/* Filter and New Folder Toolbar */}
        <div
          style={{
            padding: "8px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <input
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder={t("Filter subfolders...", "搜索子文件夹...")}
            style={{
              flex: 1,
              padding: "5px 10px",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              color: "var(--text)",
              outline: "none",
            }}
          />
          <button
            onClick={() => setCreatingFolder((v) => !v)}
            style={{
              padding: "5px 10px",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              background: "var(--bg-hover)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              color: "var(--text)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {t("+ New Folder", "+ 新建文件夹")}
          </button>
        </div>

        {/* New Folder Inline Form */}
        {creatingFolder && (
          <div
            style={{
              padding: "10px 14px",
              background: "var(--bg-panel)",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreateFolder();
                  if (e.key === "Escape") setCreatingFolder(false);
                }}
                placeholder="Folder name"
                autoFocus
                style={{
                  flex: 1,
                  padding: "5px 8px",
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                  background: "var(--bg)",
                  border: "1px solid var(--accent)",
                  borderRadius: 5,
                  color: "var(--text)",
                  outline: "none",
                }}
              />
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim() || loading}
                style={{
                  padding: "5px 12px",
                  fontSize: 11,
                  background: "var(--accent)",
                  border: "none",
                  borderRadius: 5,
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Create
              </button>
              <button
                onClick={() => setCreatingFolder(false)}
                style={{
                  padding: "5px 10px",
                  fontSize: 11,
                  background: "none",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  color: "var(--text-muted)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
            {createError && (
              <div style={{ fontSize: 11, color: "#ef4444" }}>{createError}</div>
            )}
          </div>
        )}

        {/* Folder List Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px" }}>
          {loading && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>
              Loading directories...
            </div>
          )}

          {error && (
            <div style={{ padding: 16, color: "#ef4444", fontSize: 12, textAlign: "center" }}>
              {error}
            </div>
          )}

          {!loading && !error && filteredDirs.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-dim)", fontSize: 12 }}>
              No subdirectories found
            </div>
          )}

          {!loading &&
            !error &&
            filteredDirs.map((dir) => {
              const isSelected = selectedPath === dir.path;
              return (
                <div
                  key={dir.path}
                  onClick={() => setSelectedPath(dir.path)}
                  onDoubleClick={() => fetchDirectory(dir.path)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "7px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    background: isSelected ? "var(--bg-selected)" : "transparent",
                    border: isSelected ? "1px solid var(--accent)" : "1px solid transparent",
                    marginBottom: 2,
                    userSelect: "none",
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <FolderIcon size={16} />
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: isSelected ? 600 : 400,
                        color: "var(--text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {dir.name}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      fetchDirectory(dir.path);
                    }}
                    title="Open directory"
                    style={{
                      padding: "2px 8px",
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      background: "none",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    {t("Open →", "进入 →")}
                  </button>
                </div>
              );
            })}
        </div>

        {/* Modal Footer / Action Bar */}
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-panel)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              {t("Selected Path", "当前选择路径")}
            </div>
            <div
              style={{
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                color: "var(--text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontWeight: 600,
              }}
            >
              {selectedPath || currentPath}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => onSelect(selectedPath || currentPath)}
              disabled={!(selectedPath || currentPath)}
              style={{
                padding: "8px 18px",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "var(--font-mono)",
                background: "var(--accent)",
                border: "none",
                borderRadius: 6,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              {t("Select Folder", "选择此文件夹")}
            </button>
            <button
              onClick={onClose}
              style={{
                padding: "8px 14px",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              {t("Cancel", "取消")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
