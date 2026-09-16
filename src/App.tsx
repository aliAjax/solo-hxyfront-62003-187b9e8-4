import { useMemo, useState } from "react";
import type { CaseDef, Resolution, SandboxState, Verdict } from "./types";
import { CASES, getCase } from "./data";
import { buildSummary, evaluate, initialState } from "./engine";
import "./styles.css";

type Tab = "hyp" | "evidence" | "conflict" | "conclusion";

const VERDICTS: { key: Verdict; label: string; cls: string }[] = [
  { key: "support", label: "支持", cls: "v-support" },
  { key: "refute", label: "反驳", cls: "v-refute" },
  { key: "verify", label: "待核实", cls: "v-verify" },
];

const CRED_LABEL = { high: "高可信", medium: "中可信", low: "低可信" } as const;
const CRED_CLS = { high: "cred-high", medium: "cred-mid", low: "cred-low" } as const;
const TYPE_LABEL = {
  time: "时间矛盾",
  ecology: "生态不可能",
  chain: "证据链断点",
  credibility: "可信度",
  basis: "依据完整性",
} as const;

function nowTs() {
  return Date.now();
}
function fmtTime(ts: number) {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

// ───────────────────────────── 主组件 ─────────────────────────────

export default function App() {
  const [caseDef, setCaseDef] = useState<CaseDef>(CASES[0]);
  const [state, setState] = useState<SandboxState>(() => initialState(CASES[0]));
  const [past, setPast] = useState<SandboxState[]>([]);
  const [tab, setTab] = useState<Tab>("hyp");
  const [catFilter, setCatFilter] = useState<string>("全部");
  const [resolutionDraft, setResolutionDraft] = useState<{
    ids: string[];
    mode: "merge" | "explain";
    note: string;
  } | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [toast, setToast] = useState<string>("");

  const ev = useMemo(() => evaluate(caseDef, state), [caseDef, state]);
  const marks = state.marks[state.activeHyp] ?? {};
  const hyp = caseDef.hypotheses.find((h) => h.id === state.activeHyp)!;
  const hypResolutions = useMemo(
    () => state.resolutions.filter((r) => r.hypId === state.activeHyp),
    [state.resolutions, state.activeHyp]
  );
  const coveredIds = useMemo(
    () => new Set(hypResolutions.flatMap((r) => r.ids)),
    [hypResolutions]
  );

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2200);
  }

  // 所有写操作先压栈，供"回退一步"使用
  function commit(next: SandboxState, logText?: string) {
    setPast((p) => [...p, state]);
    setState({
      ...next,
      history: logText
        ? [...next.history, { at: nowTs(), text: logText }]
        : next.history,
    });
  }

  function undo() {
    if (past.length === 0 || state.locked) return;
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setState(prev);
  }

  function switchCase(id: string) {
    const c = getCase(id);
    setCaseDef(c);
    setPast([]);
    setState(initialState(c));
    setCatFilter("全部");
    setTab("hyp");
    setShowSummary(false);
  }

  function switchHyp(hypId: string) {
    if (state.activeHyp === hypId || state.locked) return;
    commit(
      { ...state, activeHyp: hypId },
      `切换待复核假设：${caseDef.hypotheses.find((h) => h.id === hypId)!.label}`
    );
    setTab("evidence");
  }

  function mark(evidenceId: string, verdict: Verdict) {
    if (state.locked) return;
    const prev = marks[evidenceId];
    const nextVerdict: Verdict | undefined = prev === verdict ? undefined : verdict;
    const hypMarks = { ...marks };
    if (nextVerdict) hypMarks[evidenceId] = nextVerdict;
    else delete hypMarks[evidenceId];
    const e = caseDef.evidence.find((x) => x.id === evidenceId)!;
    commit(
      {
        ...state,
        marks: { ...state.marks, [state.activeHyp]: hypMarks },
      },
      nextVerdict
        ? `将 ${evidenceId}《${e.title}》标注为${
            nextVerdict === "support" ? "支持" : nextVerdict === "refute" ? "反驳" : "待核实"
          }（假设：${hyp.label}）`
        : `取消 ${evidenceId} 的标注`
    );
  }

  function setNote(text: string) {
    if (state.locked) return;
    // 文本编辑不入操作栈，直接写
    setState({ ...state, notes: { ...state.notes, [state.activeHyp]: text } });
  }

  function saveResolution() {
    if (!resolutionDraft) return;
    const { ids, mode, note } = resolutionDraft;
    if (ids.length === 0 || note.trim().length < 4) return;
    const r: Resolution = { hypId: state.activeHyp, ids: [...ids], mode, note: note.trim(), at: nowTs() };
    commit(
      { ...state, resolutions: [...state.resolutions, r] },
      `${mode === "merge" ? "合并证据组" : "解释保留"} ${ids.join("、")}：${note.trim()}`
    );
    setResolutionDraft(null);
    flash("冲突已处置，相关系统提示解除阻断");
  }

  function removeResolution(idx: number) {
    if (state.locked) return;
    const r = state.resolutions[idx];
    commit(
      { ...state, resolutions: state.resolutions.filter((_, i) => i !== idx) },
      `撤销处置（${r.ids.join("、")}）`
    );
  }

  function tryLock() {
    if (!ev.canLock || state.locked) return;
    commit(
      { ...state, locked: true, lockedAt: nowTs() },
      `锁定复核结论：${hyp.label}`
    );
    setShowSummary(true);
    setTab("conclusion");
  }

  function unlock() {
    commit({ ...state, locked: false, lockedAt: undefined }, "解锁结论，继续复核编辑");
    setShowSummary(false);
  }

  const summary = state.locked ? buildSummary(caseDef, state, ev) : "";

  function exportDownload() {
    const blob = new Blob([summary], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `复核摘要_${caseDef.name}_${fmtTime(state.lockedAt!).replace(/[\/\s:]/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summary);
      flash("摘要已复制到剪贴板");
    } catch {
      flash("复制失败，请使用下载导出");
    }
  }

  const categories = useMemo(
    () => Array.from(new Set(caseDef.evidence.map((e) => e.category))),
    [caseDef]
  );
  const visibleEvidence =
    catFilter === "全部"
      ? caseDef.evidence
      : caseDef.evidence.filter((e) => e.category === catFilter);

  const unresolvedContra = ev.unresolved.filter((f) => f.check.severity === "contradiction");
  const unresolvedWarn = ev.unresolved.filter((f) => f.check.severity === "warn");
  const firedResolved = ev.fired.filter((f) => f.resolved);

  // ── 面板 1：案情与假设 ──
  const HypPanel = (
    <section className="panel panel-hyp card">
      <h2 className="card-title">案情摘要</h2>
      <p className="case-sub">{caseDef.subtitle}</p>
      <ol className="brief">
        {caseDef.brief.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ol>
      <div className="materials-meta">
        材料 {caseDef.evidence.length} 份 · 假设 {caseDef.hypotheses.length} 个 · 检查点{" "}
        {caseDef.checks.length} 项
      </div>

      <h2 className="card-title">选择待复核假设</h2>
      <div className="hyp-list">
        {caseDef.hypotheses.map((h, i) => {
          const active = h.id === state.activeHyp;
          return (
            <button
              key={h.id}
              className={`hyp-item ${active ? "active" : ""}`}
              onClick={() => switchHyp(h.id)}
              disabled={state.locked && !active}
            >
              <span className="hyp-tag">假设 {i + 1}</span>
              <span className="hyp-label">{h.label}</span>
              {active && <span className="hyp-current">复核中</span>}
            </button>
          );
        })}
      </div>

      <div className="hyp-statement">
        <h3>当前假设陈述</h3>
        <p>{hyp.statement}</p>
        <p className="hyp-req">
          锁定所需依据类别：{hyp.requiredCategories.join("、")}
          <br />
          （每类至少一条高/中可信“支持”证据；低可信证据须经合并处置方可计入）
        </p>
      </div>
    </section>
  );

  // ── 面板 2：证据标注 ──
  const EvidencePanel = (
    <section className="panel panel-evidence card">
      <h2 className="card-title">
        案件材料标注
        <span className="title-count">
          支持 {ev.counts.support} · 反驳 {ev.counts.refute} · 待核实 {ev.counts.verify} ·
          未标 {ev.counts.unmarked}
        </span>
      </h2>
      <div className="filter-row">
        {["全部", ...categories].map((c) => (
          <button
            key={c}
            className={`chip ${catFilter === c ? "on" : ""}`}
            onClick={() => setCatFilter(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <p className="hint">对每份材料选择其对当前假设的意义；再次点击同一判定可取消。</p>

      <div className="evidence-list">
        {visibleEvidence.map((e) => {
          const v = marks[e.id];
          const resolution = hypResolutions.find((r) => r.ids.includes(e.id));
          return (
            <article key={e.id} className={`evidence ${v ? `marked-${v}` : ""}`}>
              <header>
                <span className="ev-id">{e.id}</span>
                <span className="ev-cat">{e.category}</span>
                <span className={`cred ${CRED_CLS[e.credibility]}`}>
                  {CRED_LABEL[e.credibility]}
                </span>
              </header>
              <h3>{e.title}</h3>
              <p className="ev-body">{e.body}</p>
              <p className="ev-source">来源：{e.source}</p>
              {resolution && (
                <p className="ev-resolution">
                  ⚑ {resolution.mode === "merge" ? "合并入证据组" : "已作解释保留"}：
                  {resolution.note}
                </p>
              )}
              <div className="verdict-row">
                {VERDICTS.map((opt) => (
                  <button
                    key={opt.key}
                    className={`vbtn ${opt.cls} ${v === opt.key ? "sel" : ""}`}
                    onClick={() => mark(e.id, opt.key)}
                    disabled={state.locked}
                  >
                    {opt.label}
                  </button>
                ))}
                {coveredIds.has(e.id) && <span className="covered-tag">已纳入处置</span>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );

  // ── 面板 3：系统提示与冲突处置 ──
  const AlertItem = ({ f }: { f: (typeof ev.fired)[number] }) => (
    <div
      className={`alert ${
        f.check.severity === "contradiction" ? "alert-contra" : "alert-warn"
      } ${f.resolved ? "alert-done" : ""}`}
    >
      <div className="alert-head">
        <span className="alert-type">
          {f.check.severity === "contradiction" ? "⛔" : "⚠"} {TYPE_LABEL[f.check.type]}
        </span>
        {f.resolved ? (
          <span className="alert-status ok">已处置</span>
        ) : (
          <span className="alert-status">待处置</span>
        )}
      </div>
      <strong>{f.check.title}</strong>
      <p>{f.check.detail}</p>
      <p className="alert-refs">关联材料：{f.refs.join("、") || "—"}</p>
      {f.resolved ? (
        <p className="alert-resolution">
          处置（{f.resolution!.mode === "merge" ? "合并证据组" : "解释保留"}）：
          {f.resolution!.note}
        </p>
      ) : (
        <>
          <p className="alert-suggest">建议：{f.check.suggestion}</p>
          <button
            className="btn btn-sm"
            disabled={state.locked}
            onClick={() => setResolutionDraft({ ids: f.refs, mode: "merge", note: "" })}
          >
            合并/解释此冲突
          </button>
        </>
      )}
    </div>
  );

  const ConflictPanel = (
    <section className="panel panel-conflict card">
      <h2 className="card-title">
        系统提示
        <span className="title-count">
          {unresolvedContra.length} 阻断 · {unresolvedWarn.length} 注意 ·{" "}
          {firedResolved.length} 已处置
        </span>
      </h2>

      <div className="progress-rail">
        <div className="rail-step">
          <span className={`dot ${ev.counts.unmarked === 0 ? "ok" : ""}`}>1</span>标注
        </div>
        <div className="rail-step">
          <span className={`dot ${unresolvedContra.length === 0 ? "ok" : "bad"}`}>2</span>矛盾
        </div>
        <div className="rail-step">
          <span className={`dot ${ev.basis.every((b) => b.ok) ? "ok" : ""}`}>3</span>依据
        </div>
        <div className="rail-step">
          <span className={`dot ${ev.canLock ? "ok" : ""}`}>4</span>锁定
        </div>
      </div>

      {ev.fired.length === 0 && (
        <div className="empty">
          暂无触发的系统提示。
          <br />
          当标注组合出现时间矛盾、物种生态不可能或证据链断点时，将在此持续提示。
        </div>
      )}

      {unresolvedContra.map((f) => (
        <AlertItem key={f.check.id} f={f} />
      ))}
      {unresolvedWarn.map((f) => (
        <AlertItem key={f.check.id} f={f} />
      ))}
      {firedResolved.map((f) => (
        <AlertItem key={f.check.id} f={f} />
      ))}

      <h2 className="card-title mt">冲突处置记录</h2>
      {hypResolutions.length === 0 && (
        <p className="empty">
          尚未合并或解释任何冲突。处置方式：合并证据组（给出统一解释）或解释保留（声明为何并存）。
        </p>
      )}
      {hypResolutions.map((r) => {
        const globalIdx = state.resolutions.indexOf(r);
        return (
        <div key={globalIdx} className="resolution-item">
          <div>
            <span className="res-mode">
              {r.mode === "merge" ? "🔗 合并证据组" : "📝 解释保留"}
            </span>
            <span className="res-ids">{r.ids.join("、")}</span>
          </div>
          <p>{r.note}</p>
          <div className="res-foot">
            <span>{fmtTime(r.at)}</span>
            <button
              className="link-btn"
              disabled={state.locked}
              onClick={() => removeResolution(globalIdx)}
            >
              撤销
            </button>
          </div>
        </div>
        );
      })}
      <button
        className="btn btn-ghost btn-sm"
        disabled={state.locked}
        onClick={() => setResolutionDraft({ ids: [], mode: "merge", note: "" })}
      >
        ＋ 手动合并/解释任意材料
      </button>

      {ev.pending.length > 0 && (
        <>
          <h2 className="card-title mt">待核实清单</h2>
          <p className="hint">
            以下材料已标“待核实”，锁定后摘要中会单列，不计入定案依据。
          </p>
          <ul className="pending-list">
            {ev.pending.map((id) => {
              const e = caseDef.evidence.find((x) => x.id === id)!;
              return (
                <li key={id}>
                  <b>{id}</b> {e.title}
                  <span className="pending-src">{e.source}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );

  // ── 面板 4：依据、锁定与导出 ──
  const ConclusionPanel = (
    <section className="panel panel-conclusion card">
      <h2 className="card-title">依据完整性</h2>
      <ul className="basis-list">
        {ev.basis.map((b) => (
          <li key={b.category} className={b.ok ? "ok" : "bad"}>
            <span>{b.ok ? "✔" : "✘"}</span>
            <span className="basis-cat">{b.category}</span>
            <span className="basis-ev">
              {b.ok ? b.evIds.join("、") : "缺少高/中可信支持证据"}
            </span>
          </li>
        ))}
      </ul>

      <h2 className="card-title">复核人结论说明</h2>
      <textarea
        className="note-input"
        rows={5}
        placeholder="请写明：对原鉴定的复核意见、矛盾如何解决、结论区间及保留意见（锁定必填）……"
        value={state.notes[state.activeHyp] ?? ""}
        onChange={(e) => setNote(e.target.value)}
        disabled={state.locked}
      />

      <h2 className="card-title mt">锁定门禁</h2>
      {state.locked ? (
        <div className="lock-box locked">
          <p className="lock-title">🔒 结论已锁定</p>
          <p className="lock-hyp">{hyp.label}</p>
          <p className="lock-time">锁定时间：{fmtTime(state.lockedAt!)}</p>
          <div className="lock-actions">
            <button className="btn btn-primary" onClick={() => setShowSummary(true)}>
              查看 / 导出复核摘要
            </button>
            <button className="btn btn-ghost" onClick={unlock}>
              解锁继续编辑
            </button>
          </div>
        </div>
      ) : (
        <div className="lock-box">
          {ev.blockers.length === 0 ? (
            <>
              <p className="gate-ok">
                ✔ 阻断矛盾均已处置，依据类别齐备，材料全部标注，结论说明已填写。
              </p>
              <button className="btn btn-lock" onClick={tryLock}>
                🔒 锁定复核结论
              </button>
            </>
          ) : (
            <>
              <p className="gate-block-title">以下问题未处理，不能锁定：</p>
              <ul className="blockers">
                {ev.blockers.map((b, i) => (
                  <li key={i}>⛔ {b}</li>
                ))}
              </ul>
              <button className="btn btn-lock disabled" disabled>
                🔒 锁定复核结论
              </button>
            </>
          )}
        </div>
      )}

      <h2 className="card-title mt">操作轨迹</h2>
      <ol className="history">
        {[...state.history].reverse().map((h) => (
          <li key={`${h.at}-${h.text}`}>
            <span className="hist-time">{fmtTime(h.at)}</span>
            <span>{h.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );

  const tabBadge: Record<Tab, number> = {
    hyp: 0,
    evidence: ev.counts.unmarked,
    conflict: unresolvedContra.length,
    conclusion: ev.canLock && !state.locked ? 1 : 0,
  };

  return (
    <div className="app" data-tab={tab}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">虫</span>
          <div>
            <h1>法医昆虫学鉴定结论复核沙盘</h1>
            <p className="brand-sub">
              物种 · 发育阶段 · 死亡时间 · 保存污染 · 来源可信度 —— 矛盾驱动的结论复核
            </p>
          </div>
        </div>
        <div className="top-actions">
          <select
            className="case-select"
            value={caseDef.id}
            onChange={(e) => switchCase(e.target.value)}
            disabled={state.locked}
            title="切换内置案件"
          >
            {CASES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            className="btn btn-ghost btn-sm"
            onClick={undo}
            disabled={past.length === 0 || state.locked}
          >
            ↩ 回退一步
          </button>
          {state.locked && (
            <button className="btn btn-ghost btn-sm" onClick={unlock}>
              解锁
            </button>
          )}
        </div>
      </header>

      {state.locked && (
        <div className="locked-banner">
          🔒 当前结论已锁定（{hyp.label}）。编辑前需先解锁；切换案件不可用。
        </div>
      )}

      <main className="layout">
        {HypPanel}
        {EvidencePanel}
        {ConflictPanel}
        {ConclusionPanel}
      </main>

      <nav className="tabbar">
        {(
          [
            ["hyp", "① 假设"],
            ["evidence", "② 材料"],
            ["conflict", "③ 冲突"],
            ["conclusion", "④ 结论"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            className={`tab ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
            {tabBadge[key] > 0 && <span className="tab-badge">{tabBadge[key]}</span>}
          </button>
        ))}
      </nav>

      {/* 冲突处置弹窗 */}
      {resolutionDraft && (
        <div className="modal-mask" onClick={() => setResolutionDraft(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>合并冲突 / 解释保留</h2>
            <p className="hint">
              选择纳入处置的材料并给出实质性说明（至少 4 个字）。保存后，涉及这些材料的系统提示将解除阻断，并写入复核摘要。
            </p>
            <div className="pick-grid">
              {caseDef.evidence.map((e) => {
                const on = resolutionDraft.ids.includes(e.id);
                return (
                  <button
                    key={e.id}
                    className={`pick ${on ? "on" : ""}`}
                    onClick={() =>
                      setResolutionDraft((d) =>
                        d
                          ? {
                              ...d,
                              ids: on
                                ? d.ids.filter((x) => x !== e.id)
                                : [...d.ids, e.id],
                            }
                          : d
                      )
                    }
                  >
                    {e.id} {e.category}
                  </button>
                );
              })}
            </div>
            <div className="mode-row">
              <label>
                <input
                  type="radio"
                  checked={resolutionDraft.mode === "merge"}
                  onChange={() =>
                    setResolutionDraft((d) => (d ? { ...d, mode: "merge" } : d))
                  }
                />
                🔗 合并证据组：统一为一条解释链
              </label>
              <label>
                <input
                  type="radio"
                  checked={resolutionDraft.mode === "explain"}
                  onChange={() =>
                    setResolutionDraft((d) => (d ? { ...d, mode: "explain" } : d))
                  }
                />
                📝 解释保留：声明并存理由与证明力取舍
              </label>
            </div>
            <textarea
              className="note-input"
              rows={4}
              placeholder="例：尸体先在城区温暖环境定殖（B1 大头金蝇），8 月 5 日凌晨经 B8 车辆运至山林，现场低温下发育迟缓，故 B3 虫龄大于现场停留时长。"
              value={resolutionDraft.note}
              onChange={(e) =>
                setResolutionDraft((d) => (d ? { ...d, note: e.target.value } : d))
              }
            />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setResolutionDraft(null)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                disabled={
                  resolutionDraft.ids.length === 0 || resolutionDraft.note.trim().length < 4
                }
                onClick={saveResolution}
              >
                保存处置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 摘要弹窗 */}
      {showSummary && state.locked && (
        <div className="modal-mask" onClick={() => setShowSummary(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h2>复核摘要（可导出）</h2>
            <pre className="summary-pre">{summary}</pre>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowSummary(false)}>
                关闭
              </button>
              <button className="btn btn-ghost" onClick={copySummary}>
                复制全文
              </button>
              <button className="btn btn-primary" onClick={exportDownload}>
                ⬇ 下载 .md
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
