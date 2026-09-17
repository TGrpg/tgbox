import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Tabs, TabsList, TabsTab } from "@/components/coss/ui/tabs.tsx";
import { PageHeader } from "@/components/shell/page-header.tsx";
import { promotionCountsQueryOptions } from "@/functions/promotions.ts";
import { ActiveTab } from "./active-tab.tsx";
import { ManualTab } from "./manual-tab.tsx";
import { OrdersTab } from "./orders-tab.tsx";
import { ProductsTab } from "./products-tab.tsx";

export const promotionTabs = ["orders", "active", "new", "products"] as const;
export type PromotionTab = (typeof promotionTabs)[number];

const tabLabels: Record<PromotionTab, string> = {
  orders: "订单",
  active: "投放中",
  new: "新建",
  products: "档位价格",
};

export function PromotionsPage({
  tab,
  onTabChange,
}: {
  tab: PromotionTab;
  onTabChange: (tab: PromotionTab) => void;
}) {
  const counts = useQuery(promotionCountsQueryOptions());
  const badge = (item: PromotionTab) => {
    const count =
      item === "orders" ? counts.data?.pendingBanners : item === "active" ? counts.data?.active : 0;
    return count ? (
      <Badge variant={item === "orders" ? "warning" : "secondary"} size="sm">
        {count}
      </Badge>
    ) : null;
  };

  return (
    <>
      <PageHeader
        title="推广"
        description="置顶和首页横幅：订单审核、投放管理、手动推广与价格。上线或下架会触发网站重建。"
      />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = promotionTabs.find((item) => item === value);
          if (next) onTabChange(next);
        }}
      >
        <TabsList className="mb-4">
          {promotionTabs.map((item) => (
            <TabsTab key={item} value={item}>
              {tabLabels[item]}
              {badge(item)}
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>
      {tab === "orders" && <OrdersTab />}
      {tab === "active" && <ActiveTab />}
      {tab === "new" && <ManualTab onCreated={() => onTabChange("active")} />}
      {tab === "products" && <ProductsTab />}
    </>
  );
}
