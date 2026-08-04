import type { ReactNode } from "react";

interface SettingsPanelProps {
  readonly title: string;
  readonly children: ReactNode;
}

export default function SettingsPanel({ title, children }: SettingsPanelProps) {
  return (
    <section className="settings-panel" aria-label={title}>
      <p className="settings-panel-title">{title}</p>
      <div className="settings-panel-body">{children}</div>
    </section>
  );
}