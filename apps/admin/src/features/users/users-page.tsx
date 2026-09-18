import { Tabs, TabsList, TabsTab } from "@/components/coss/ui/tabs.tsx";
import { PageHeader } from "@/components/shell/page-header.tsx";
import { BroadcastPanel } from "./broadcast-panel.tsx";
import { UserList } from "./user-list.tsx";

export const userTabs = ["list", "broadcast"] as const;
export type UserTab = (typeof userTabs)[number];

const tabLabels: Record<UserTab, string> = { list: "用户列表", broadcast: "群发" };

export function UsersPage({
  tab,
  onTabChange,
}: {
  tab: UserTab;
  onTabChange: (tab: UserTab) => void;
}) {
  return (
    <>
      <PageHeader
        title="用户"
        description="在私聊里用过收录机器人的人。可以查看投稿和订单、拉黑、私信，或一键群发通知。"
      />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = userTabs.find((item) => item === value);
          if (next) onTabChange(next);
        }}
      >
        <TabsList className="mb-4">
          {userTabs.map((item) => (
            <TabsTab key={item} value={item}>
              {tabLabels[item]}
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>
      {tab === "list" ? <UserList /> : <BroadcastPanel />}
    </>
  );
}
