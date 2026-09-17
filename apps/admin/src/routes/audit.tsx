import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shell/page-header.tsx";
import { AuditLog } from "@/features/audit/audit-log.tsx";
import { BuildPanel } from "@/features/audit/build-panel.tsx";

export const Route = createFileRoute("/audit")({
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader title="操作日志" description="谁在什么时候做了什么；可在此手动触发站点构建。" />
      <div className="flex flex-col gap-4">
        <BuildPanel />
        <AuditLog />
      </div>
    </>
  );
}
