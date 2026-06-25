import { useMemo, useState } from "react";
import { Dropdown, Empty, Input, Pagination } from "antd";

const PAGE_SIZE = 50;

interface IconOption {
  label: string;
  name: string;
  value: string;
}

const iconFiles = import.meta.glob<string>("../assets/iconfont/*.svg", {
  eager: true,
  import: "default",
  query: "?url",
});

const formatIconName = (path: string) => {
  const filename = path.split("/").pop() ?? path;
  return filename.replace(/\.svg$/i, "");
};

const normalizeKeyword = (value: string) => value.trim().toLowerCase();

const iconOptions: IconOption[] = Object.entries(iconFiles)
  .map(([path, value]) => {
    const name = formatIconName(path);
    return { label: name.replace(/[-_]/g, " "), name, value };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

export const defaultProxyGroupIcon = iconOptions.find((icon) => icon.name === "default")?.value ?? iconOptions[0]?.value ?? "";

function IconPreview({ value, label }: { value: string; label?: string }) {
  const isSvgAsset = value.endsWith(".svg") || value.startsWith("data:image/svg+xml") || value.includes(".svg?");
  if (isSvgAsset) return <img src={value} alt={label ?? ""} />;
  return <span className="icon-picker-fallback">{value || "?"}</span>;
}

export function IconPicker({ value, onChange }: { value?: string; onChange?: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const currentValue = value || defaultProxyGroupIcon;
  const selectedIcon = iconOptions.find((icon) => icon.value === currentValue);

  const filteredIcons = useMemo(() => {
    const keyword = normalizeKeyword(search);
    if (!keyword) return iconOptions;
    return iconOptions.filter((icon) => `${icon.name} ${icon.label}`.toLowerCase().includes(keyword));
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(filteredIcons.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visibleIcons = filteredIcons.slice(pageStart, pageStart + PAGE_SIZE);

  const popup = (
    <div className="icon-picker-dropdown" onMouseDown={(event) => event.stopPropagation()}>
      <Input
        allowClear
        size="small"
        placeholder="搜索图标文件名"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
      />
      {visibleIcons.length ? (
        <div className="icon-picker-grid">
          {visibleIcons.map((icon) => (
            <button
              key={icon.value}
              type="button"
              className={`icon-picker-option${icon.value === currentValue ? " selected" : ""}`}
              title={icon.label}
              aria-label={`选择图标 ${icon.label}`}
              onClick={() => {
                onChange?.(icon.value);
                setOpen(false);
              }}
            >
              <IconPreview value={icon.value} label={icon.label} />
            </button>
          ))}
        </div>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到图标" />
      )}
      <div className="icon-picker-footer">
        <span>{filteredIcons.length ? `${pageStart + 1}-${Math.min(pageStart + PAGE_SIZE, filteredIcons.length)} / ${filteredIcons.length}` : "0 / 0"}</span>
        {filteredIcons.length > PAGE_SIZE && (
          <Pagination simple size="small" current={currentPage} total={filteredIcons.length} pageSize={PAGE_SIZE} onChange={setPage} />
        )}
      </div>
    </div>
  );

  return (
    <Dropdown open={open} trigger={["click"]} menu={{ items: [] }} popupRender={() => popup} onOpenChange={setOpen}>
      <button type="button" className="icon-picker-trigger" aria-haspopup="menu" aria-expanded={open}>
        <span className="icon-picker-trigger-icon">
          <IconPreview value={currentValue} label={selectedIcon?.label} />
        </span>
        <span className="icon-picker-trigger-name">{selectedIcon?.label ?? "自定义图标"}</span>
      </button>
    </Dropdown>
  );
}
