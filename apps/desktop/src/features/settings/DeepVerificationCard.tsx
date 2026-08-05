import type { ProviderVerification } from "./settingsClient";
import {
  mapDeepVerification,
  providerVerifyLabels,
} from "./providerVerify";

interface DeepVerificationCardProps {
  readonly verification: ProviderVerification;
}

function stepLabel(status: "pass" | "fail" | "skip"): string {
  switch (status) {
    case "pass":
      return "通过";
    case "fail":
      return "失败";
    case "skip":
      return "跳过";
  }
}

/**
 * Renders the result of the unified provider deep-verification endpoint: the
 * overall state, the real current step, the failing step detail, the
 * recommended action and the full per-step trace.
 */
export default function DeepVerificationCard({
  verification,
}: DeepVerificationCardProps) {
  const state = mapDeepVerification(verification);
  const currentStep = verification.steps.find(
    (step) => step.id === verification.current_step,
  );
  const failedStep = verification.steps.find((step) => step.status === "fail");

  return (
    <div
      className="settings-verify-card"
      data-testid="deep-verify-card"
      role={state === "verified" ? "status" : "note"}
    >
      <p>
        <strong>
          {state === "verified" ? "验证成功" : "验证未通过"}（{providerVerifyLabels[state]}）
        </strong>
      </p>
      {verification.current_step ? (
        <p>
          当前步骤：{currentStep?.label ?? verification.current_step}
        </p>
      ) : null}
      {failedStep?.detail ? <p>失败详情：{failedStep.detail}</p> : null}
      {verification.recommended_action ? (
        <p>建议：{verification.recommended_action}</p>
      ) : null}
      {verification.total_duration_ms > 0 ? (
        <p>总耗时：{verification.total_duration_ms} ms</p>
      ) : null}
      {verification.steps.length > 0 ? (
        <ul aria-label="深度验证步骤">
          {verification.steps.map((step) => (
            <li key={step.id}>
              <span>{step.label}</span> · <span>{stepLabel(step.status)}</span>
              {step.detail ? <p>{step.detail}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}