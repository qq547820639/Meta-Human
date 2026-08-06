/**
 * Performance budget configuration for the natural-conversation pipeline, plus
 * pure helpers to check measured latencies against those budgets.
 *
 * This is the CI-enforceable SLO contract for one exchange: each perceptual
 * stage has a budget in milliseconds, and any measured stage that exceeds it is
 * a violation. The benchmark script (`scripts/generate-conversation-budget-report.sh`)
 * computes the P95 latency of every stage from a fixture of real samples and
 * turns a violation into a non-zero exit, so a latency regression blocks CI.
 *
 * Budgeted stages (mirrors the metric names in ../conversationMetrics):
 *
 *   speechToFirstTranscriptMs : speech start -> first interim transcript char
 *   speechEndToTranscriptMs   : speech end   -> final (confirmed) transcript
 *   submitToFirstTokenMs      : transcript submitted -> first reply token
 *   firstTokenToFirstAudioMs  : first reply token -> first TTS audio chunk
 *   avSyncErrorMs             : measured audio/video sync deviation
 *   interruptToSilenceMs      : interrupt issued -> assistant audio stopped
 */

import { percentileLatencies } from "../conversationMetrics";

export type ConversationBudgetMetric =
  | "speechToFirstTranscriptMs"
  | "speechEndToTranscriptMs"
  | "submitToFirstTokenMs"
  | "firstTokenToFirstAudioMs"
  | "avSyncErrorMs"
  | "interruptToSilenceMs";

export interface ConversationBudget {
  readonly metric: ConversationBudgetMetric;
  /** Human-readable label (used in generated reports). */
  readonly label: string;
  /** Budget in milliseconds. */
  readonly budgetMs: number;
}

export const conversationBudgets: readonly ConversationBudget[] = [
  { metric: "speechToFirstTranscriptMs", label: "说话→首字转写", budgetMs: 500 },
  { metric: "speechEndToTranscriptMs", label: "停说→转写完成", budgetMs: 800 },
  { metric: "submitToFirstTokenMs", label: "提交→首 token", budgetMs: 1500 },
  { metric: "firstTokenToFirstAudioMs", label: "首 token→首段语音", budgetMs: 2000 },
  { metric: "avSyncErrorMs", label: "音画同步偏差", budgetMs: 300 },
  { metric: "interruptToSilenceMs", label: "打断→声音停止", budgetMs: 300 },
];

export function budgetForMetric(
  metric: ConversationBudgetMetric,
): ConversationBudget | undefined {
  return conversationBudgets.find((budget) => budget.metric === metric);
}

export interface BudgetViolation {
  readonly metric: ConversationBudgetMetric;
  readonly label: string;
  readonly budgetMs: number;
  readonly measuredMs: number;
  /** How far over budget, in ms (always positive). */
  readonly overMs: number;
}

/**
 * Check a single measured snapshot (one exchange) against the budgets. Only
 * metrics that were actually measured are evaluated — unmeasured stages are
 * never fabricated as pass or fail.
 */
export function checkConversationBudget(
  measured: Partial<Record<ConversationBudgetMetric, number>>,
  budgets: readonly ConversationBudget[] = conversationBudgets,
): BudgetViolation[] {
  const violations: BudgetViolation[] = [];
  for (const budget of budgets) {
    const value = measured[budget.metric];
    if (value === undefined || value === null) {
      continue;
    }
    if (value > budget.budgetMs) {
      violations.push({
        metric: budget.metric,
        label: budget.label,
        budgetMs: budget.budgetMs,
        measuredMs: value,
        overMs: value - budget.budgetMs,
      });
    }
  }
  return violations;
}

/**
 * Aggregate a set of measured samples per stage (e.g. many turns over a session)
 * into a P95 summary and check the P95 against the budgets. This is what the CI
 * benchmark uses: a single slow outlier no longer decides, but a consistently
 * slow stage (P95 over budget) still fails.
 */
export function violationsForPercentiles(
  samples: Partial<Record<ConversationBudgetMetric, ReadonlyArray<number>>>,
  budgets: readonly ConversationBudget[] = conversationBudgets,
): BudgetViolation[] {
  const measured: Partial<Record<ConversationBudgetMetric, number>> = {};
  for (const budget of budgets) {
    const arr = samples[budget.metric];
    if (!arr || arr.length === 0) {
      continue;
    }
    const p95 = percentileLatencies(arr as number[]).p95;
    if (p95 !== null) {
      measured[budget.metric] = p95;
    }
  }
  return checkConversationBudget(measured, budgets);
}

/**
 * Render a measured snapshot as a Markdown table (budget | measured | status).
 * Unmeasured stages show "—" / N/A and never claim a pass.
 */
export function summarizeBudgetResult(
  measured: Partial<Record<ConversationBudgetMetric, number>>,
  budgets: readonly ConversationBudget[] = conversationBudgets,
): string {
  const lines: string[] = [];
  lines.push("| 指标 | 预算 (ms) | 实测 P95 (ms) | 状态 |");
  lines.push("| --- | ---: | ---: | --- |");
  for (const budget of budgets) {
    const value = measured[budget.metric];
    const measuredText =
      value === undefined || value === null ? "—" : `${Math.round(value)}`;
    const status =
      value === undefined || value === null
        ? "N/A"
        : value <= budget.budgetMs
          ? "✅ 达标"
          : "❌ 超限";
    lines.push(`| ${budget.label} | ${budget.budgetMs} | ${measuredText} | ${status} |`);
  }
  return lines.join("\n");
}

export interface BudgetReport {
  readonly label: string;
  readonly samples: Partial<Record<ConversationBudgetMetric, ReadonlyArray<number>>>;
}

/** Build a full human-readable Markdown report from a sample set. */
export function buildBudgetReportMarkdown(
  report: BudgetReport,
  budgets: readonly ConversationBudget[] = conversationBudgets,
): string {
  const measured: Partial<Record<ConversationBudgetMetric, number>> = {};
  for (const budget of budgets) {
    const arr = report.samples[budget.metric];
    if (!arr || arr.length === 0) {
      continue;
    }
    const p95 = percentileLatencies(arr as number[]).p95;
    if (p95 !== null) {
      measured[budget.metric] = p95;
    }
  }
  const violations = checkConversationBudget(measured, budgets);
  const lines: string[] = [];
  lines.push(`# 对话性能预算报告 — ${report.label}`);
  lines.push("");
  lines.push(`生成时间：${new Date().toISOString()}`);
  lines.push("");
  lines.push("各阶段取 P95 延迟（ms）与预算对比。");
  lines.push("");
  lines.push(summarizeBudgetResult(measured, budgets));
  lines.push("");
  lines.push(
    violations.length === 0
      ? "**结论：全部达标签 ✅**"
      : `**结论：${violations.length} 项超限 ❌**`,
  );
  return lines.join("\n");
}