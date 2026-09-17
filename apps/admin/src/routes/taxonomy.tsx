import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/coss/ui/tabs.tsx";
import { PageHeader } from "@/components/shell/page-header.tsx";
import { CategoriesPanel } from "@/features/taxonomy/categories-panel.tsx";
import { TagsPanel } from "@/features/taxonomy/tags-panel.tsx";
import { taxonomyQueryOptions } from "@/functions/taxonomy.ts";

export const Route = createFileRoute("/taxonomy")({
  component: Page,
});

function Page() {
  const taxonomy = useQuery(taxonomyQueryOptions());
  return (
    <>
      <PageHeader
        title="分类和标签"
        description="站点从数据库读取分类与标签；修改后会标记站点待构建。拖动手柄调整分类顺序。"
      />
      {taxonomy.isPending ? (
        <div className="grid gap-4 xl:grid-cols-3">
          {["a", "b", "c"].map((key) => (
            <Skeleton key={key} className="h-96 rounded-2xl" />
          ))}
        </div>
      ) : taxonomy.isError ? (
        <p className="text-destructive-foreground text-sm">加载失败：{taxonomy.error.message}</p>
      ) : (
        <Tabs defaultValue="categories">
          <TabsList className="self-start">
            <TabsTab value="categories">分类 · {taxonomy.data.categories.length}</TabsTab>
            <TabsTab value="tags">标签 · {taxonomy.data.tags.length}</TabsTab>
          </TabsList>
          <TabsPanel value="categories" className="pt-2">
            <CategoriesPanel data={taxonomy.data} />
          </TabsPanel>
          <TabsPanel value="tags" className="pt-2">
            <TagsPanel tags={taxonomy.data.tags} />
          </TabsPanel>
        </Tabs>
      )}
    </>
  );
}
