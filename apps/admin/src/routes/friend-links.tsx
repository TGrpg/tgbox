import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shell/page-header.tsx";
import { FriendLinksPage } from "@/features/friend-links/friend-links-page.tsx";

export const Route = createFileRoute("/friend-links")({
  component: Page,
});

function Page() {
  return (
    <>
      <PageHeader
        title="友情链接"
        description="审核机器人收到的友链申请，编辑网站页脚和 /links/ 页显示的友情链接。"
      />
      <FriendLinksPage />
    </>
  );
}
