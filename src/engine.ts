// 复核规则引擎：矛盾检测 / 生态不可能 / 证据链断点 / 锁定门禁 / 摘要生成
import type { CaseDef, Check, Resolution, SandboxState, Verdict } from "./types";

export interface FiredCheck {
  check: Check;
  /** 该检查点引用的证据 ID */
  refs: string[];
  /** 是否已通过合并/解释处置 */
  resolved: boolean;
  /** 处置记录（若有） */
  resolution?: Resolution;
}

export interface BasisCoverage {
  category: string;
  ok: boolean;
  evIds: string[];
}

export interface Evaluation {
  fired: FiredCheck[];
  unresolved: FiredCheck[];
  basis: BasisCoverage[];
  pending: string[]; // 待核实证据标题（id）
  counts: { support: number; refute: number; verify: number; unmarked: number };
  /** 锁定前必须解决的阻断项 */
  blockers: string[];
  canLock: boolean;
}

/** 从检查点函数中提取引用的证据 ID（如 A1、B12、C3） */
const REF_RE = /\b([ABC]\d{1,2})\b/g;
export function checkRefs(check: Check): string[] {
  const text = `${check.detail} ${check.suggestion} ${check.when.toString()}`;
  return Array.from(new Set((text.match(REF_RE) ?? [])));
}

/** 处置记录覆盖的证据 id 集合 */
export function coveredByResolutions(resolutions: Resolution[]): Set<string> {
  const s = new Set<string>();
  for (const r of resolutions) for (const id of r.ids) s.add(id);
  return s;
}

function resolutionCovering(resolutions: Resolution[], ids: string[]): Resolution | undefined {
  return resolutions.find((r) => ids.some((id) => r.ids.includes(id)));
}

/** 核心评估：随标注状态持续运行 */
export function evaluate(caseDef: CaseDef, state: SandboxState): Evaluation {
  const marks = state.marks[state.activeHyp] ?? {};
  const resolutions = state.resolutions.filter((r) => r.hypId === state.activeHyp);
  const covered = coveredByResolutions(resolutions);

  const fired: FiredCheck[] = caseDef.checks
    .filter((c) => c.when(marks))
    .map((check) => {
      const refs = checkRefs(check).filter((id) => caseDef.evidence.some((e) => e.id === id));
      // 处置规则：处置说明必须实质性覆盖该检查点的关键证据
      let resolution: Resolution | undefined;
      for (const r of resolutions) {
        const hits = refs.filter((id) => r.ids.includes(id));
        if (hits.length >= Math.min(2, refs.length)) {
          resolution = r;
          break;
        }
      }
      return { check, refs, resolved: resolution !== undefined, resolution };
    });

  const unresolved = fired.filter((f) => !f.resolved);

  // 依据覆盖：假设所需的每个证据类别需有可用"支持"；
  // 若该类无支持（假设主动反驳该类材料），则类内材料必须全部完成标注，
  // 且其中的反驳/待核实项均已纳入处置说明，方可计入覆盖。
  const basis: BasisCoverage[] = [];
  const activeHyp = caseDef.hypotheses.find((h) => h.id === state.activeHyp)!;
  for (const cat of activeHyp.requiredCategories) {
    const inCat = caseDef.evidence.filter((e) => e.category === cat);
    const supporting = inCat.filter((e) => marks[e.id] === "support");
    // 低可信证据需要同类高/中可信支持，或已被处置说明覆盖
    const usable = supporting.filter(
      (e) => e.credibility !== "low" || covered.has(e.id)
    );
    let ok = usable.length > 0;
    if (!ok) {
      const allMarked = inCat.every((e) => marks[e.id] !== undefined);
      const contestedHandled = inCat
        .filter((e) => marks[e.id] === "refute" || marks[e.id] === "verify")
        .every((e) => covered.has(e.id));
      ok = inCat.length > 0 && allMarked && contestedHandled;
    }
    basis.push({
      category: cat,
      ok,
      evIds: usable.map((e) => e.id),
    });
  }

  const pending = caseDef.evidence
    .filter((e) => marks[e.id] === "verify")
    .map((e) => e.id);

  const counts = { support: 0, refute: 0, verify: 0, unmarked: 0 };
  for (const e of caseDef.evidence) {
    const v = marks[e.id];
    if (v === "support") counts.support++;
    else if (v === "refute") counts.refute++;
    else if (v === "verify") counts.verify++;
    else counts.unmarked++;
  }

  const blockers: string[] = [];
  const unresolvedContra = unresolved.filter((f) => f.check.severity === "contradiction");
  if (unresolvedContra.length > 0)
    blockers.push(`存在 ${unresolvedContra.length} 项未处置的时间矛盾 / 生态不可能 / 证据链断点`);
  const missingBasis = basis.filter((b) => !b.ok).map((b) => b.category);
  if (missingBasis.length > 0) blockers.push(`缺少依据类别：${missingBasis.join("、")}`);
  if (counts.unmarked > 0) blockers.push(`仍有 ${counts.unmarked} 份材料未完成三态标注`);
  if (!state.notes[state.activeHyp]?.trim()) blockers.push("未填写复核人结论说明");

  return {
    fired,
    unresolved,
    basis,
    pending,
    counts,
    blockers,
    canLock: blockers.length === 0,
  };
}

// ───────────────────────────── 初始状态 ─────────────────────────────

export function initialState(caseDef: CaseDef): SandboxState {
  return {
    caseId: caseDef.id,
    activeHyp: caseDef.hypotheses[0].id,
    marks: Object.fromEntries(caseDef.hypotheses.map((h) => [h.id, {}])),
    notes: Object.fromEntries(caseDef.hypotheses.map((h) => [h.id, ""])),
    resolutions: [],
    locked: false,
    history: [
      {
        at: Date.now(),
        text: `建立复核沙盘：${caseDef.name}`,
      },
    ],
  };
}

// ───────────────────────────── 导出摘要 ─────────────────────────────

const VERDICT_TEXT: Record<Verdict, string> = {
  support: "支持",
  refute: "反驳",
  verify: "待核实",
};
const CRED_TEXT = { high: "高", medium: "中", low: "低" } as const;
const TYPE_TEXT = {
  time: "时间矛盾",
  ecology: "生态不可能",
  chain: "证据链断点",
  credibility: "可信度",
  basis: "依据完整性",
} as const;

export function buildSummary(caseDef: CaseDef, state: SandboxState, ev: Evaluation): string {
  const hyp = caseDef.hypotheses.find((h) => h.id === state.activeHyp)!;
  const marks = state.marks[state.activeHyp] ?? {};
  const lines: string[] = [];

  lines.push(`# 法医昆虫学鉴定结论复核摘要`);
  lines.push("");
  lines.push(`案件：${caseDef.name}`);
  lines.push(`说明：${caseDef.subtitle}`);
  lines.push(`复核状态：已锁定（锁定时间 ${new Date(state.lockedAt!).toLocaleString("zh-CN")}）`);
  lines.push("");
  lines.push(`## 一、复核结论`);
  lines.push("");
  lines.push(`采纳假设：${hyp.label}`);
  lines.push("");
  lines.push(hyp.statement);
  lines.push("");
  lines.push(`复核人说明：${state.notes[state.activeHyp]?.trim() || "（未填写）"}`);
  lines.push("");

  lines.push(`## 二、证据标注一览（${caseDef.evidence.length} 份材料）`);
  lines.push("");
  for (const e of caseDef.evidence) {
    const v = marks[e.id];
    lines.push(
      `- [${v ? VERDICT_TEXT[v] : "未标注"}] ${e.id}｜${e.category}｜${e.title}（来源可信度：${CRED_TEXT[e.credibility]}）`
    );
    if (v === "verify") lines.push(`  - 待核实事项，未作为定案依据`);
  }
  lines.push("");

  lines.push(`## 三、依据类别覆盖`);
  lines.push("");
  for (const b of ev.basis)
    lines.push(`- ${b.ok ? "✔" : "✘"} ${b.category}${b.ok ? `（${b.evIds.join("、")}）` : ""}`);
  lines.push("");

  const activeResolutions = state.resolutions.filter((r) => r.hypId === state.activeHyp);
  if (ev.fired.length > 0 || activeResolutions.length > 0) {
    lines.push(`## 四、系统提示与处置记录`);
    lines.push("");
    const rendered = new Set<Resolution>();
    for (const f of ev.fired) {
      lines.push(
        `- 【${TYPE_TEXT[f.check.type]}${f.check.severity === "contradiction" ? "·阻断" : "·注意"}】${f.check.title}`
      );
      lines.push(`  - 内容：${f.check.detail}`);
      const res = f.resolution;
      if (res) {
        rendered.add(res);
        lines.push(
          `  - 处置（${res.mode === "merge" ? "合并证据组" : "解释保留"}）：${res.note}（涉及 ${res.ids.join("、")}）`
        );
      } else {
        lines.push(`  - 状态：未处置`);
      }
    }
    // 与当前触发项无关的处置（如对"待核实"材料的降级说明）也须入档
    const standalone = activeResolutions.filter((r) => !rendered.has(r));
    for (const res of standalone) {
      lines.push(
        `- 【依据处置】${res.mode === "merge" ? "合并证据组" : "解释保留"}（涉及 ${res.ids.join("、")}）`
      );
      lines.push(`  - 处置：${res.note}`);
    }
    lines.push("");
  }

  const pending = caseDef.evidence.filter((e) => marks[e.id] === "verify");
  if (pending.length > 0) {
    lines.push(`## 五、待核实清单（不作为定案依据）`);
    lines.push("");
    for (const e of pending) lines.push(`- ${e.id} ${e.title}：${e.source}`);
    lines.push("");
  }

  lines.push(`## 六、操作轨迹`);
  lines.push("");
  for (const h of state.history)
    lines.push(`- ${new Date(h.at).toLocaleString("zh-CN")}　${h.text}`);
  lines.push("");
  lines.push("—— 本摘要由法医昆虫学复核沙盘生成，仅用于复核训练与质量控制 ——");

  return lines.join("\n");
}
