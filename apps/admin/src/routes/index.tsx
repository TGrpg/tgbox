import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { AdminStats } from "@tgbox/db";
import {
  BotIcon,
  CircleCheckIcon,
  ClipboardListIcon,
  EyeOffIcon,
  ImageIcon,
  type LucideIcon,
  MegaphoneIcon,
  RocketIcon,
  Trash2Icon,
  UserPlusIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Card } from "@/components/coss/ui/card.tsx";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import { NumberRoll } from "@/components/number-roll.tsx";
import { PageHeader } from "@/components/shell/page-header.tsx";
import {
  BuildButton,
  DashboardActivity,
  LastTrigger,
} from "@/features/dashboard/dashboard-activity.tsx";
import { promotionCountsQueryOptions } from "@/functions/promotions.ts";
import { adminStatsQueryOptions } from "@/functions/stats.ts";
import { userStatsQueryOptions } from "@/functions/users.ts";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

const dateTime = (ms: number) =>
  new Date(ms).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });

function Dashboard() {
  const stats = useQuery(adminStatsQueryOptions());

  return (
    <>
      <PageHeader title="看板" description="收录概况与站点构建状态" actions={<BuildButton />} />
      {stats.isPending ? (
        <StatGrid>
          {["a", "b", "c", "d", "e", "f", "g", "h"].map((key) => (
            <Skeleton key={key} className="h-28 rounded-2xl" />
          ))}
        </StatGrid>
      ) : stats.isError ? (
        <p className="text-destructive-foreground text-sm">加载失败：{stats.error.message}</p>
      ) : (
        <DashboardCards data={stats.data} />
      )}
      <PromotionCards />
      <UserCards />
      <div className="mt-4">
        <DashboardActivity />
      </div>
    </>
  );
}

type Stat = { label: string; value: number; icon: LucideIcon; tone?: "primary" | "warning" };

function DashboardCards({ data }: { data: AdminStats }) {
  const stats: Stat[] = [
    { label: "已收录", value: data.byStatus.approved, icon: CircleCheckIcon, tone: "primary" },
    {
      label: "待审核",
      value: data.pendingSubmissions,
      icon: ClipboardListIcon,
      tone: data.pendingSubmissions > 0 ? "warning" : undefined,
    },
    { label: "系统隐藏（7 天内）", value: data.hiddenBySystemLast7d, icon: EyeOffIcon },
    { label: "管理员隐藏", value: data.byStatus.hidden_by_admin, icon: EyeOffIcon },
    { label: "频道", value: data.byKind.channel, icon: MegaphoneIcon },
    { label: "群组", value: data.byKind.group, icon: UsersIcon },
    { label: "机器人", value: data.byKind.bot, icon: BotIcon },
    { label: "已删除", value: data.byStatus.removed, icon: Trash2Icon },
  ];

  return (
    <div className="flex flex-col gap-4">
      <StatGrid>
        {stats.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <Card className="h-full gap-3 p-4">
              <div className="flex items-center justify-between text-muted-foreground text-sm">
                {stat.label}
                <stat.icon
                  className={
                    stat.tone === "primary"
                      ? "size-4 text-primary-accent"
                      : stat.tone === "warning"
                        ? "size-4 text-warning-foreground"
                        : "size-4"
                  }
                  aria-hidden
                />
              </div>
              <div className="font-semibold text-3xl tracking-tight">
                <NumberRoll value={stat.value} />
              </div>
            </Card>
          </motion.div>
        ))}
      </StatGrid>

      <Card className="flex-row flex-wrap items-center gap-x-8 gap-y-3 p-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">站点状态</span>
          {data.dirtySince === null ? (
            <Badge variant="success">已是最新</Badge>
          ) : (
            <Badge variant="warning">待构建 · {dateTime(data.dirtySince)} 起</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">上次构建</span>
          <span>{data.lastBuildAt === null ? "暂无记录" : dateTime(data.lastBuildAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">上次手动触发</span>
          <LastTrigger />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">条目总数</span>
          <span className="tabular-nums">{data.total.toLocaleString("zh-CN")}</span>
        </div>
      </Card>
    </div>
  );
}

function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">{children}</div>;
}

function PromotionCards() {
  const counts = useQuery(promotionCountsQueryOptions());
  if (!counts.data) return null;
  const cards = [
    {
      label: "待审核广告",
      value: counts.data.pendingAds,
      icon: ImageIcon,
      tab: "orders" as const,
      warn: counts.data.pendingAds > 0,
    },
    { label: "投放中推广", value: counts.data.active, icon: RocketIcon, tab: "active" as const },
  ];
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 md:gap-4">
      {cards.map((card, index) => (
        <motion.div
          key={card.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.03, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <Card
            render={<Link to="/promotions" search={{ tab: card.tab }} />}
            className="h-full flex-row items-center justify-between gap-3 p-4 transition-colors hover:bg-accent/40"
          >
            <span className="flex items-center gap-2 text-muted-foreground text-sm">
              <card.icon
                className={card.warn ? "size-4 text-warning-foreground" : "size-4"}
                aria-hidden
              />
              {card.label}
            </span>
            <span className="font-semibold text-2xl tracking-tight">
              <NumberRoll value={card.value} />
            </span>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}

function UserCards() {
  const stats = useQuery(userStatsQueryOptions());
  if (!stats.data) return null;
  const cards = [
    { label: "机器人用户", value: stats.data.total, icon: UsersIcon },
    { label: "7 日新增", value: stats.data.new7d, icon: UserPlusIcon },
    { label: "付费用户", value: stats.data.paying, icon: WalletIcon },
  ];
  return (
    <div className="mt-4 grid grid-cols-3 gap-3 md:gap-4">
      {cards.map((card, index) => (
        <motion.div
          key={card.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.03, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <Card
            render={<Link to="/users" search={{ tab: "list" }} />}
            className="h-full gap-2 p-4 transition-colors hover:bg-accent/40"
          >
            <span className="flex items-center gap-2 text-muted-foreground text-sm">
              <card.icon className="size-4" aria-hidden />
              {card.label}
            </span>
            <span className="font-semibold text-2xl tracking-tight">
              <NumberRoll value={card.value} />
            </span>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
