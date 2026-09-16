// 法医昆虫学鉴定结论复核沙盘 —— 类型定义

export type Verdict = "support" | "refute" | "verify";
export type Credibility = "high" | "medium" | "low";
export type CheckType = "time" | "ecology" | "chain" | "credibility" | "basis";

export interface Evidence {
  id: string;
  /** 材料类别：物种鉴定 / 发育阶段 / 死亡时间 / 保存污染 / 来源可信度 / 场景线索 */
  category: string;
  title: string;
  /** 材料正文 */
  body: string;
  /** 来源与可信度 */
  source: string;
  credibility: Credibility;
}

/** 规则检查点：随标注状态即时给出提示 */
export interface Check {
  id: string;
  type: CheckType;
  title: string;
  detail: string;
  /**
   * severity: 触发后的严重级别
   * contradiction 矛盾/不可能/断点（红色），warn 注意（琥珀色）
   */
  severity: "contradiction" | "warn";
  /** 触发条件（缺少标注即为"未评估"，不触发） */
  when: (v: Record<string, Verdict>) => boolean;
  /** 建议处置方向 */
  suggestion: string;
}

export interface Hypothesis {
  id: string;
  label: string;
  statement: string;
  /** 锁定所需依据类别（至少各类一条"支持"） */
  requiredCategories: string[];
}

export interface CaseDef {
  id: string;
  name: string;
  subtitle: string;
  /** 案情摘要 */
  brief: string[];
  evidence: Evidence[];
  hypotheses: Hypothesis[];
  checks: Check[];
}

/** 冲突处置（合并或解释），按假设隔离 */
export interface Resolution {
  hypId: string;
  ids: string[];
  mode: "merge" | "explain";
  note: string;
  at: number;
}

/** 一条操作日志，用于回退 */
export interface LogEntry {
  at: number;
  text: string;
}

export interface SandboxState {
  caseId: string;
  activeHyp: string;
  /** 按假设保存标注：[hypId][evidenceId] */
  marks: Record<string, Record<string, Verdict>>;
  notes: Record<string, string>;
  resolutions: Resolution[];
  locked: boolean;
  lockedAt?: number;
  history: LogEntry[];
}
