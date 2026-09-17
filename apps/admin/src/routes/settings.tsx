import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shell/page-header.tsx";
import { SettingsPage } from "@/features/settings/settings-page.tsx";

export const Route = createFileRoute("/settings")({
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader
        title="设置"
        description="机器人和网站的运营参数。每个分区单独保存，所有改动都会记入操作日志。"
      />
      <SettingsPage />
    </>
  );
}
