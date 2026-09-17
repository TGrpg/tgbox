import { type EntryKind, entryKinds } from "@tgbox/shared";
import { GripVerticalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import { type FormEvent, useEffect, useState } from "react";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import { Card } from "@/components/coss/ui/card.tsx";
import { Input } from "@/components/coss/ui/input.tsx";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/coss/ui/select.tsx";
import type { Taxonomy, TaxonomyCategory } from "@/functions/taxonomy.ts";
import { ConfirmDelete } from "./confirm-delete.tsx";
import { CategoryIconPreview } from "./icons.tsx";
import { kindLabels } from "./labels.ts";
import { useTaxonomyMutations } from "./use-taxonomy-mutations.ts";

type Mutations = ReturnType<typeof useTaxonomyMutations>;

export function CategoriesPanel({ data }: { data: Taxonomy }) {
  const mutations = useTaxonomyMutations();
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {entryKinds.map((kind) => (
        <KindCard
          key={kind}
          kind={kind}
          categories={data.categories.filter((category) => category.kind === kind)}
          icons={data.icons}
          mutations={mutations}
        />
      ))}
    </div>
  );
}

function KindCard({
  kind,
  categories,
  icons,
  mutations,
}: {
  kind: EntryKind;
  categories: TaxonomyCategory[];
  icons: readonly string[];
  mutations: Mutations;
}) {
  const [order, setOrder] = useState(() => categories.map((category) => category.id));
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const serverOrder = categories.map((category) => category.id).join(",");
  // Follow the server whenever it changes (create, delete, confirmed reorder).
  useEffect(() => {
    setOrder(serverOrder === "" ? [] : serverOrder.split(",").map(Number));
  }, [serverOrder]);

  const byId = new Map(categories.map((category) => [category.id, category]));
  const commitOrder = () => {
    if (order.join(",") !== serverOrder) mutations.reorderCategories.mutate({ kind, ids: order });
  };

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">{kindLabels[kind]}</h2>
          <Badge variant="secondary">{categories.length}</Badge>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <PlusIcon aria-hidden />
          新增
        </Button>
      </div>
      <AnimatePresence initial={false}>
        {editing === "new" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b bg-muted/40"
          >
            <CategoryForm
              icons={icons}
              initial={{ slug: "", nameZh: "", nameEn: "", icon: null }}
              pending={mutations.upsertCategory.isPending}
              onCancel={() => setEditing(null)}
              onSubmit={(values) =>
                mutations.upsertCategory.mutate(
                  { ...values, kind },
                  { onSuccess: (result) => result.ok && setEditing(null) },
                )
              }
            />
          </motion.div>
        )}
      </AnimatePresence>
      <Reorder.Group axis="y" values={order} onReorder={setOrder} className="flex flex-col">
        <AnimatePresence initial={false}>
          {order.flatMap((id) => {
            const category = byId.get(id);
            if (!category) return [];
            return (
              <CategoryRow
                key={id}
                category={category}
                icons={icons}
                editing={editing === id}
                onEdit={() => setEditing(id)}
                onCancel={() => setEditing(null)}
                onDragEnd={commitOrder}
                mutations={mutations}
              />
            );
          })}
        </AnimatePresence>
      </Reorder.Group>
      {categories.length === 0 && (
        <p className="px-4 py-8 text-center text-muted-foreground text-sm">暂无分类</p>
      )}
    </Card>
  );
}

function CategoryRow({
  category,
  icons,
  editing,
  onEdit,
  onCancel,
  onDragEnd,
  mutations,
}: {
  category: TaxonomyCategory;
  icons: readonly string[];
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onDragEnd: () => void;
  mutations: Mutations;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={category.id}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0 }}
      whileDrag={{ scale: 1.02, boxShadow: "0 8px 24px rgb(0 0 0 / 0.12)", zIndex: 10 }}
      className="relative border-b bg-card last:border-b-0"
    >
      {editing ? (
        <CategoryForm
          icons={icons}
          initial={category}
          pending={mutations.upsertCategory.isPending}
          onCancel={onCancel}
          onSubmit={(values) =>
            mutations.upsertCategory.mutate(
              { ...values, id: category.id, kind: category.kind },
              { onSuccess: (result) => result.ok && onCancel() },
            )
          }
        />
      ) : (
        <div className="flex items-center gap-2 py-2 pr-2 pl-1">
          <button
            type="button"
            aria-label={`拖动排序：${category.nameZh}`}
            className="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground active:cursor-grabbing"
            onPointerDown={(event) => controls.start(event)}
          >
            <GripVerticalIcon className="size-4" aria-hidden />
          </button>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
            <CategoryIconPreview icon={category.icon} className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-sm">{category.nameZh}</div>
            <div className="truncate text-muted-foreground text-xs">
              {category.nameEn} · <span className="font-mono">{category.slug}</span>
            </div>
          </div>
          <Badge variant="outline" className="tabular-nums" title="条目数">
            {category.entries}
          </Badge>
          <Button size="icon-sm" variant="ghost" aria-label="编辑" onClick={onEdit}>
            <PencilIcon aria-hidden />
          </Button>
          <ConfirmDelete
            title={`删除分类「${category.nameZh}」？`}
            description="该分类未被任何条目使用。删除后站点会在下次构建时移除分类页。"
            onConfirm={() => mutations.deleteCategory.mutate(category.id)}
            trigger={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={category.entries > 0 ? "有条目的分类不能删除" : "删除"}
                disabled={category.entries > 0}
              >
                <Trash2Icon aria-hidden />
              </Button>
            }
          />
        </div>
      )}
    </Reorder.Item>
  );
}

type CategoryValues = { slug: string; nameZh: string; nameEn: string; icon: string | null };

const NO_ICON = "__none__";

function CategoryForm({
  initial,
  icons,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: CategoryValues;
  icons: readonly string[];
  pending: boolean;
  onSubmit: (values: CategoryValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<CategoryValues>({
    slug: initial.slug,
    nameZh: initial.nameZh,
    nameEn: initial.nameEn,
    icon: initial.icon,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(values);
  };
  const iconItems = [
    { value: NO_ICON, label: "默认图标" },
    ...icons.map((icon) => ({ value: icon, label: icon })),
  ];
  return (
    <form onSubmit={submit} className="grid gap-2 p-3 sm:grid-cols-2">
      <Input
        aria-label="中文名"
        placeholder="中文名"
        value={values.nameZh}
        onChange={(event) => setValues({ ...values, nameZh: event.target.value })}
        autoFocus
        required
      />
      <Input
        aria-label="英文名"
        placeholder="English name"
        value={values.nameEn}
        onChange={(event) => setValues({ ...values, nameEn: event.target.value })}
        required
      />
      <Input
        aria-label="slug"
        placeholder="slug"
        className="font-mono"
        value={values.slug}
        onChange={(event) => setValues({ ...values, slug: event.target.value })}
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        required
      />
      <Select
        items={iconItems}
        value={values.icon ?? NO_ICON}
        onValueChange={(icon) => setValues({ ...values, icon: icon === NO_ICON ? null : icon })}
      >
        <SelectTrigger aria-label="图标">
          <SelectValue>
            {(value: string) => (
              <span className="flex items-center gap-2">
                <CategoryIconPreview icon={value === NO_ICON ? null : value} className="size-4" />
                {value === NO_ICON ? "默认图标" : value}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {iconItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              <span className="flex items-center gap-2">
                <CategoryIconPreview
                  icon={item.value === NO_ICON ? null : item.value}
                  className="size-4"
                />
                {item.label}
              </span>
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" size="sm" loading={pending}>
          保存
        </Button>
      </div>
    </form>
  );
}
