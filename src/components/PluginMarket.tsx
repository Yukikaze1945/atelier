import { useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  Search,
  Star,
  Package,
  Check,
  FolderPlus,
  Power,
  Trash2,
  ShieldCheck,
} from "lucide-react";
import type { PluginRecord } from "../../packages/sdk/src";
import { host } from "../host";
import { Button, Empty, Glyph, Modal } from "./ui";

export function PluginMarket({
  plugins,
  notify,
  onChange,
}: {
  plugins: PluginRecord[];
  notify: (s: string) => void;
  onChange: () => Promise<void>;
}) {
  const [tab, setTab] = useState("recommended");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [pending, setPending] = useState<PluginRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const visible = useMemo(
    () =>
      plugins.filter(
        (p) =>
          (tab !== "recommended" || p.builtin) &&
          (category === "all" ||
            p.manifest.pages.some((d) => d.type === category)) &&
          `${p.manifest.name} ${p.manifest.description}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [plugins, tab, query, category],
  );
  async function inspect() {
    try {
      const directory = await host.request<string | null>("dialog.directory", {
        title: "选择包含 plugin.json 的插件目录",
      });
      if (directory)
        setPending(
          await host.request<PluginRecord>("plugin.inspect", { directory }),
        );
    } catch (e) {
      notify(String(e));
    }
  }
  async function install() {
    if (!pending) return;
    setBusy(true);
    try {
      await host.request("plugin.install", { directory: pending.directory });
      setPending(null);
      await onChange();
      notify("插件安装成功，可以在节点画布中添加页面。");
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function toggle(p: PluginRecord) {
    try {
      await host.request("plugin.enable", {
        pluginId: p.manifest.id,
        enabled: !p.enabled,
      });
      await onChange();
    } catch (e) {
      notify(String(e));
    }
  }
  async function uninstall(p: PluginRecord) {
    try {
      await host.request("plugin.uninstall", { pluginId: p.manifest.id });
      await onChange();
      notify("已取消插件注册，原文件与项目数据保留。");
    } catch (e) {
      notify(String(e));
    }
  }
  return (
    <main className="center-main market">
      <div className="section-heading">
        <div>
          <div className="eyebrow">EXTEND YOUR WORKSPACE</div>
          <h1>插件市场</h1>
          <p>页面、模型、滤镜与主题，通过插件连接到你的创作。</p>
        </div>
        <Button onClick={inspect}>
          <FolderPlus size={17} />
          从本地安装插件
        </Button>
      </div>
      <div className="market-toolbar">
        <div className="pill-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "recommended"}
            onClick={() => setTab("recommended")}
          >
            推荐
          </button>
          <button
            role="tab"
            aria-selected={tab === "browse"}
            onClick={() => setTab("browse")}
          >
            浏览
          </button>
          <button
            role="tab"
            aria-selected={tab === "installed"}
            onClick={() => setTab("installed")}
          >
            已安装 <span>{plugins.length}</span>
          </button>
        </div>
        <div className="spacer" />
        <div className="search">
          <Search size={16} />
          <input
            aria-label="搜索插件"
            placeholder="搜索插件"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="market-body">
        <aside className="market-categories">
          <span className="eyebrow">分类</span>
          {[
            ["all", "全部插件"],
            ["media", "素材管理"],
            ["timeline", "剪辑"],
            ["export", "导出"],
          ].map(([id, name]) => (
            <button
              key={id}
              className={category === id ? "active" : ""}
              onClick={() => setCategory(id)}
            >
              {name}
            </button>
          ))}
        </aside>
        <section className="market-list">
          <div className="catalog-note">
            <Package size={17} />
            {tab === "installed"
              ? "管理本机插件。线上版本与更新检查尚未接入。"
              : "当前展示本机插件目录；线上市场与 GitHub Stars 同步尚未接入。"}
          </div>
          {visible.length === 0 ? (
            <Empty title="没有匹配的插件">
              可以安装本地插件包，或调整搜索条件。
            </Empty>
          ) : (
            visible.map((p) => (
              <article className="plugin-card" key={p.manifest.id}>
                <div className="plugin-icon">
                  <Glyph name={p.manifest.icon || "layers"} size={26} />
                </div>
                <div className="plugin-copy">
                  <h3>
                    {p.manifest.name}
                    {p.builtin && (
                      <span className="official">
                        <ShieldCheck size={12} />
                        官方基础
                      </span>
                    )}
                  </h3>
                  <div className="plugin-meta">
                    {p.manifest.author} · v{p.manifest.version}
                    {p.manifest.repository && (
                      <button
                        onClick={() =>
                          host
                            .request("shell.openExternal", {
                              url: p.manifest.repository,
                            })
                            .catch((e) => notify(e.message))
                        }
                      >
                        <ExternalLink size={12} />
                        GitHub
                      </button>
                    )}
                  </div>
                  <p>{p.manifest.description}</p>
                  <div className="tags">
                    {p.manifest.pages.map((d) => (
                      <span key={d.id}>{d.name}</span>
                    ))}
                    <span className="stars">
                      <Star size={12} />—
                    </span>
                  </div>
                </div>
                <div className="plugin-actions">
                  {tab === "installed" ? (
                    <>
                      <Button onClick={() => toggle(p)}>
                        <Power size={14} />
                        {p.enabled ? "禁用" : "启用"}
                      </Button>
                      {!p.builtin && (
                        <button
                          className="text-button muted"
                          onClick={() => uninstall(p)}
                        >
                          <Trash2 size={13} />
                          卸载
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="installed-pill">
                      <Check size={14} />
                      {p.enabled ? "已安装" : "已禁用"}
                    </span>
                  )}
                </div>
              </article>
            ))
          )}
        </section>
      </div>
      {pending && (
        <Modal
          title="安装第三方插件"
          subtitle={pending.manifest.name}
          onClose={() => setPending(null)}
        >
          <div className="modal-body">
            <p>{pending.manifest.description}</p>
            <div className="notice">
              插件可以使用工作站全部公开能力，并以当前用户身份运行代码。请确认你信任此来源后继续。
            </div>
            <p className="muted small">{pending.directory}</p>
            <p>
              提供页面：
              {pending.manifest.pages.map((d) => d.name).join("、") || "无"}
            </p>
            {plugins.some((p) => p.manifest.id === pending.manifest.id) && (
              <p className="warning-text">
                此插件 ID
                已安装。本次将更新注册版本，已有项目节点保留固定版本与配置。
              </p>
            )}
          </div>
          <footer className="modal-footer">
            <Button onClick={() => setPending(null)}>取消</Button>
            <Button className="primary" disabled={busy} onClick={install}>
              <Download size={16} />
              {busy ? "安装中…" : "继续安装"}
            </Button>
          </footer>
        </Modal>
      )}
    </main>
  );
}
