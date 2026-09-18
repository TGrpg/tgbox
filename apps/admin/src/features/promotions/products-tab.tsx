import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ProductKind } from "@tgbox/shared";
import { PlusIcon, SaveIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import { Card } from "@/components/coss/ui/card.tsx";
import { Input } from "@/components/coss/ui/input.tsx";
import { Label } from "@/components/coss/ui/label.tsx";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import { Switch } from "@/components/coss/ui/switch.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/coss/ui/table.tsx";
import { toastManager } from "@/components/coss/ui/toast.tsx";
import { OptionSelect } from "@/features/entries/option-select.tsx";
import { useIsMobile } from "@/features/entries/use-is-mobile.ts";
import {
  $setPlacementSlots,
  $upsertProduct,
  type ProductRow,
  productsQueryOptions,
} from "@/functions/promotions.ts";
import { invalidate } from "@/lib/query-keys.ts";
import { productKindLabels, productKindOptions, productKindVariants } from "./labels.ts";
import { newProductDraft, type ProductDraft, parseProductDraft, toDraft } from "./product-draft.ts";

const columns = ["类型", "中文名", "英文名", "天数", "Stars", "USDT", "上架", "排序"];

export function ProductsTab() {
  const list = useQuery(productsQueryOptions());
  const mobile = useIsMobile();
  const [adding, setAdding] = useState(false);

  if (list.isPending) return <Skeleton className="h-64 rounded-2xl" />;
  if (list.isError) {
    return <p className="text-destructive-foreground text-sm">加载失败：{list.error.message}</p>;
  }

  const layout = mobile ? "card" : "row";
  const editors = (
    <>
      {adding && <ProductEditor key="new" layout={layout} onDone={() => setAdding(false)} />}
      {list.data.map((product) => (
        // Remount when the saved row changes so the form starts from the server state.
        <ProductEditor key={JSON.stringify(product)} layout={layout} product={product} />
      ))}
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      <PlacementSlots products={list.data} />
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground text-sm">
          机器人 /promote 里每个广告位的时长和价格。改价只影响之后的订单；网站上不显示价格。
        </p>
        <Button className="ml-auto" size="sm" disabled={adding} onClick={() => setAdding(true)}>
          <PlusIcon aria-hidden />
          新增商品
        </Button>
      </div>
      {list.data.length === 0 && !adding ? (
        <Card className="items-center p-10 text-muted-foreground text-sm">还没有商品</Card>
      ) : mobile ? (
        <div className="flex flex-col gap-2">{editors}</div>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column, index) => (
                  <TableHead key={column} className={index === 0 ? "pl-4" : undefined}>
                    {column}
                  </TableHead>
                ))}
                <TableHead className="pr-4 text-right">
                  <span className="sr-only">操作</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>{editors}</TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function ProductEditor({
  product,
  layout,
  onDone,
}: {
  product?: ProductRow;
  layout: "row" | "card";
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const initial = product ? toDraft(product) : newProductDraft;
  const [draft, setDraft] = useState<ProductDraft>(initial);
  const patch = (next: Partial<ProductDraft>) => setDraft((current) => ({ ...current, ...next }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const parsed = parseProductDraft(draft);

  const save = useMutation({
    mutationFn: () => {
      if (!parsed.ok) throw new Error(parsed.error);
      return $upsertProduct({ data: { ...parsed.value, id: product?.id } });
    },
    onSuccess: (result) => {
      if (result.ok) {
        toastManager.add({ type: "success", title: product ? "商品已保存" : "商品已新增" });
        onDone?.();
      } else {
        toastManager.add({
          type: "error",
          title: result.error === "not_found" ? "商品不存在" : "填写有误",
        });
      }
    },
    onError: (error) =>
      toastManager.add({ type: "error", title: "保存失败", description: error.message }),
    onSettled: () => invalidate(queryClient, "products", "audit", "dashboardActivity"),
  });

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (parsed.ok) save.mutate();
  };

  const error = dirty && !parsed.ok ? parsed.error : null;
  const fields = {
    kind: product ? (
      <Badge variant={productKindVariants[draft.kind]}>{productKindLabels[draft.kind]}</Badge>
    ) : (
      <OptionSelect
        label="类型"
        className="w-28"
        value={draft.kind}
        options={productKindOptions}
        onChange={(kind) => {
          const next = productKindOptions.find((option) => option.value === kind);
          if (next) patch({ kind: next.value });
        }}
      />
    ),
    nameZh: (
      <Input
        size="sm"
        aria-label="中文名"
        className="min-w-28"
        maxLength={40}
        value={draft.nameZh}
        onChange={(event) => patch({ nameZh: event.target.value })}
      />
    ),
    nameEn: (
      <Input
        size="sm"
        aria-label="英文名"
        className="min-w-28"
        maxLength={60}
        value={draft.nameEn}
        onChange={(event) => patch({ nameEn: event.target.value })}
      />
    ),
    days: numberInput("天数", draft.days, (days) => patch({ days })),
    priceStars: numberInput("Stars 价格", draft.priceStars, (priceStars) => patch({ priceStars })),
    priceUsdt: (
      <Input
        size="sm"
        aria-label="USDT 价格"
        className="w-20"
        inputMode="decimal"
        value={draft.priceUsdt}
        onChange={(event) => patch({ priceUsdt: event.target.value })}
      />
    ),
    active: (
      <Switch
        aria-label="上架"
        checked={draft.active}
        onCheckedChange={(active) => patch({ active })}
      />
    ),
    sort: numberInput("排序", draft.sort, (sort) => patch({ sort })),
  };

  const buttons = (
    <div className="flex items-center justify-end gap-1.5">
      {!product && (
        <Button type="button" size="sm" variant="ghost" onClick={onDone} aria-label="取消新增">
          <XIcon aria-hidden />
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant={dirty ? "default" : "outline"}
        disabled={!dirty || !parsed.ok}
        loading={save.isPending}
        onClick={() => submit()}
      >
        <SaveIcon aria-hidden />
        保存
      </Button>
    </div>
  );

  if (layout === "row") {
    return (
      <>
        <motion.tr
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className={error ? "align-top" : "border-b align-top last:border-b-0"}
        >
          <TableCell className="pl-4">{fields.kind}</TableCell>
          <TableCell>{fields.nameZh}</TableCell>
          <TableCell>{fields.nameEn}</TableCell>
          <TableCell>{fields.days}</TableCell>
          <TableCell>{fields.priceStars}</TableCell>
          <TableCell>{fields.priceUsdt}</TableCell>
          <TableCell className="align-middle">{fields.active}</TableCell>
          <TableCell>{fields.sort}</TableCell>
          <TableCell className="pr-4">{buttons}</TableCell>
        </motion.tr>
        {error && (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={10} className="pt-0 pl-4 text-destructive-foreground text-xs">
              {error}
            </TableCell>
          </TableRow>
        )}
      </>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="p-3">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            {fields.kind}
            <Label className="gap-2 font-normal text-sm">
              上架
              {fields.active}
            </Label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <CardField label="中文名">{fields.nameZh}</CardField>
            <CardField label="英文名">{fields.nameEn}</CardField>
            <CardField label="天数">{fields.days}</CardField>
            <CardField label="Stars">{fields.priceStars}</CardField>
            <CardField label="USDT">{fields.priceUsdt}</CardField>
            <CardField label="排序">{fields.sort}</CardField>
          </div>
          {error && <p className="text-destructive-foreground text-xs">{error}</p>}
          {buttons}
        </form>
      </Card>
    </motion.div>
  );
}

function CardField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 text-muted-foreground text-xs [&_[data-slot=input-control]]:w-full">
      {label}
      {children}
    </div>
  );
}

function numberInput(label: string, value: string, onChange: (value: string) => void) {
  return (
    <Input
      size="sm"
      aria-label={label}
      className="w-20"
      inputMode="numeric"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** Per-category for category pins; everywhere else, how many run on the whole site at once. */
const slotHints: Record<ProductKind, string> = {
  highlight: "全站同时高亮的条目数",
  category_pin: "每个分类同时置顶的条目数",
  pin: "全站同时置顶的条目数",
  banner: "首页和详情页同时展示的横幅数",
  announcement: "同时投放的公告条数（多条时每次打开页面随机轮换）",
};

/**
 * The size of each placement, set here rather than built in. One number per placement: all of its
 * durations share it. Saving rebuilds the site, which shows the free slots.
 */
function PlacementSlots({ products }: { products: ProductRow[] }) {
  const kinds = ProductKind.options.filter((kind) => products.some((p) => p.kind === kind));
  return (
    <Card className="gap-3 p-4">
      <div>
        <h2 className="font-semibold">广告位名额</h2>
        <p className="text-muted-foreground text-sm">
          每种广告位同时能卖出几个。满了之后机器人会告诉买家最早什么时候空出来。
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {kinds.map((kind) => (
          <SlotsField
            key={`${kind}:${Math.max(...products.filter((p) => p.kind === kind).map((p) => p.slots))}`}
            kind={kind}
            current={Math.max(...products.filter((p) => p.kind === kind).map((p) => p.slots))}
          />
        ))}
      </div>
    </Card>
  );
}

function SlotsField({ kind, current }: { kind: ProductKind; current: number }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(String(current));
  const slots = Number(value);
  const valid = /^\d+$/.test(value) && slots >= 1 && slots <= 100;
  const save = useMutation({
    mutationFn: () => $setPlacementSlots({ data: { kind, slots } }),
    onSuccess: (ok) =>
      ok
        ? toastManager.add({
            type: "success",
            title: `${productKindLabels[kind]}：${slots} 个名额`,
          })
        : toastManager.add({ type: "error", title: "名额需在 1–100 之间" }),
    onError: (error) =>
      toastManager.add({ type: "error", title: "保存失败", description: error.message }),
    onSettled: () => invalidate(queryClient, "products", "audit", "adminStats"),
  });
  return (
    <form
      className="flex flex-col gap-1.5 rounded-xl border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && slots !== current) save.mutate();
      }}
    >
      <Badge variant={productKindVariants[kind]} className="self-start">
        {productKindLabels[kind]}
      </Badge>
      <div className="flex items-center gap-2">
        <Input
          aria-label={`${productKindLabels[kind]}名额`}
          type="number"
          min={1}
          max={100}
          className="w-20"
          value={value}
          aria-invalid={!valid || undefined}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!valid || slots === current}
          loading={save.isPending}
        >
          保存
        </Button>
      </div>
      <span className="text-muted-foreground text-xs">{slotHints[kind]}</span>
    </form>
  );
}
