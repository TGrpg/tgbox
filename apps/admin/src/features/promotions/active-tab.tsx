import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlusIcon, RocketIcon, SquareIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type FormEvent, useState } from "react";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/coss/ui/alert-dialog.tsx";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import { Card } from "@/components/coss/ui/card.tsx";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/coss/ui/dialog.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/coss/ui/empty.tsx";
import { Input } from "@/components/coss/ui/input.tsx";
import { Label } from "@/components/coss/ui/label.tsx";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/coss/ui/table.tsx";
import { toastManager } from "@/components/coss/ui/toast.tsx";
import {
  $endPromotion,
  $extendPromotion,
  activePromotionsQueryOptions,
  type PromotionRow,
} from "@/functions/promotions.ts";
import { invalidate } from "@/lib/query-keys.ts";
import { PromotionContent } from "./content.tsx";
import { dateTime, productKindLabels, remainingDays } from "./labels.ts";

const ease = [0.16, 1, 0.3, 1] as const;

export function ActiveTab() {
  const list = useQuery(activePromotionsQueryOptions());
  const [extending, setExtending] = useState<PromotionRow | null>(null);
  const end = useEndPromotion();

  if (list.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {["a", "b", "c"].map((key) => (
          <Skeleton key={key} className="h-16 rounded-xl" />
        ))}
      </div>
    );
  }
  if (list.isError) {
    return <p className="text-destructive-foreground text-sm">加载失败：{list.error.message}</p>;
  }
  if (list.data.rows.length === 0) {
    return (
      <Empty className="rounded-2xl border border-dashed py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RocketIcon />
          </EmptyMedia>
          <EmptyTitle>没有投放中的推广</EmptyTitle>
          <EmptyDescription>付费订单生效或手动新建后会出现在这里。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const now = Date.now();
  const actions = (promotion: PromotionRow, wide?: boolean) => (
    <div className={wide ? "flex gap-2 *:flex-1" : "flex justify-end gap-2"}>
      <Button
        size={wide ? "default" : "sm"}
        variant="outline"
        onClick={() => setExtending(promotion)}
      >
        <CalendarPlusIcon aria-hidden />
        延长
      </Button>
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button
              size={wide ? "default" : "sm"}
              variant="destructive-outline"
              loading={end.isPending && end.variables === promotion.id}
            />
          }
        >
          <SquareIcon aria-hidden />
          提前结束
        </AlertDialogTrigger>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>提前结束这个推广？</AlertDialogTitle>
            <AlertDialogDescription>
              推广会立即下架，关联订单标记为已到期（不会自动退款），并触发网站重建。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>取消</AlertDialogClose>
            <AlertDialogClose
              render={<Button variant="destructive" />}
              onClick={() => end.mutate(promotion.id)}
            >
              结束推广
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
  const source = (promotion: PromotionRow) =>
    promotion.orderId === null ? "手动" : `订单 #${promotion.orderId}`;

  return (
    <>
      <Card className="hidden overflow-hidden p-0 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">类型</TableHead>
              <TableHead>内容</TableHead>
              <TableHead>开始</TableHead>
              <TableHead>结束</TableHead>
              <TableHead className="text-right">剩余</TableHead>
              <TableHead className="pr-4 text-right">
                <span className="sr-only">操作</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <AnimatePresence initial={false}>
              {list.data.rows.map((promotion, index) => (
                <motion.tr
                  key={promotion.id}
                  layout="position"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.25, delay: Math.min(index, 12) * 0.015, ease }}
                  className="border-b last:border-b-0"
                >
                  <TableCell className="pl-4">
                    <Badge variant={promotion.kind === "pin" ? "warning" : "info"}>
                      {productKindLabels[promotion.kind]}
                    </Badge>
                    <div className="mt-1 text-muted-foreground text-xs">{source(promotion)}</div>
                  </TableCell>
                  <TableCell>
                    <PromotionContent
                      username={promotion.entryUsername}
                      banner={promotion.banner}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                    {dateTime(promotion.startsAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                    {dateTime(promotion.endsAt)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {remainingDays(promotion.endsAt, now)} 天
                  </TableCell>
                  <TableCell className="pr-4">{actions(promotion)}</TableCell>
                </motion.tr>
              ))}
            </AnimatePresence>
          </TableBody>
        </Table>
      </Card>

      <ul className="flex flex-col gap-2 md:hidden">
        <AnimatePresence initial={false}>
          {list.data.rows.map((promotion, index) => (
            <motion.li
              key={promotion.id}
              layout="position"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, delay: Math.min(index, 8) * 0.03, ease }}
            >
              <Card className="gap-3 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={promotion.kind === "pin" ? "warning" : "info"}>
                      {productKindLabels[promotion.kind]}
                    </Badge>
                    <span className="text-muted-foreground text-xs">{source(promotion)}</span>
                  </div>
                  <span className="font-medium text-sm tabular-nums">
                    剩余 {remainingDays(promotion.endsAt, now)} 天
                  </span>
                </div>
                <PromotionContent username={promotion.entryUsername} banner={promotion.banner} />
                <div className="text-muted-foreground text-xs">
                  {dateTime(promotion.startsAt)} – {dateTime(promotion.endsAt)}
                </div>
                {actions(promotion, true)}
              </Card>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      <ExtendDialog promotion={extending} onClose={() => setExtending(null)} />
    </>
  );
}

const settleKeys = [
  "promotions",
  "orders",
  "promotionCounts",
  "adminStats",
  "audit",
  "dashboardActivity",
] as const;

function useEndPromotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (promotionId: number) => $endPromotion({ data: { promotionId } }),
    onSuccess: (ended) =>
      ended
        ? toastManager.add({
            type: "success",
            title: "推广已结束",
            description: "已标记网站待构建",
          })
        : toastManager.add({ type: "error", title: "推广不存在或已结束" }),
    onError: (error) =>
      toastManager.add({ type: "error", title: "操作失败", description: error.message }),
    onSettled: () => invalidate(queryClient, ...settleKeys),
  });
}

function ExtendDialog({
  promotion,
  onClose,
}: {
  promotion: PromotionRow | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={promotion !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup>
        {promotion && <ExtendForm key={promotion.id} promotion={promotion} onDone={onClose} />}
      </DialogPopup>
    </Dialog>
  );
}

function ExtendForm({ promotion, onDone }: { promotion: PromotionRow; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(7);
  const valid = Number.isInteger(days) && days >= 1 && days <= 365;
  const extend = useMutation({
    mutationFn: () => $extendPromotion({ data: { promotionId: promotion.id, days } }),
    onSuccess: (result) => {
      if (result.ok) {
        toastManager.add({
          type: "success",
          title: `已延长 ${days} 天`,
          description: `新的结束时间：${dateTime(result.endsAt)}`,
        });
        onDone();
      } else {
        toastManager.add({ type: "error", title: "推广不存在或已结束" });
      }
    },
    onError: (error) =>
      toastManager.add({ type: "error", title: "操作失败", description: error.message }),
    onSettled: () => invalidate(queryClient, ...settleKeys),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) extend.mutate();
  };

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>延长推广</DialogTitle>
        <DialogDescription>
          当前结束时间 {dateTime(promotion.endsAt)}
          {valid && `，延长后为 ${dateTime(promotion.endsAt + days * 24 * 60 * 60 * 1000)}`}。
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex flex-col gap-2">
        <Label htmlFor="extend-days">延长天数</Label>
        <Input
          id="extend-days"
          type="number"
          min={1}
          max={365}
          step={1}
          value={Number.isNaN(days) ? "" : days}
          onChange={(event) => setDays(event.target.valueAsNumber)}
        />
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" type="button" />}>取消</DialogClose>
        <Button type="submit" disabled={!valid} loading={extend.isPending}>
          延长
        </Button>
      </DialogFooter>
    </form>
  );
}
