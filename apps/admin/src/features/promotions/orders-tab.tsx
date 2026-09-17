import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrderStatus } from "@tgbox/shared";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, ReceiptIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
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
import { Textarea } from "@/components/coss/ui/textarea.tsx";
import { toastManager } from "@/components/coss/ui/toast.tsx";
import { OptionSelect } from "@/features/entries/option-select.tsx";
import {
  $approveOrder,
  $rejectOrder,
  ORDERS_PAGE_SIZE,
  type OrderRow,
  ordersQueryOptions,
} from "@/functions/promotions.ts";
import { invalidate } from "@/lib/query-keys.ts";
import { PromotionContent } from "./content.tsx";
import {
  dateTime,
  formatAmount,
  orderStatusLabels,
  orderStatusOptions,
  orderStatusVariants,
  productKindLabels,
  providerLabels,
} from "./labels.ts";

const ease = [0.16, 1, 0.3, 1] as const;

export function OrdersTab() {
  const [status, setStatus] = useState<OrderStatus | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [rejecting, setRejecting] = useState<OrderRow | null>(null);
  const list = useQuery(ordersQueryOptions(status, page));
  const approve = useApproveOrder();

  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));
  const actions = (order: OrderRow, wide?: boolean) =>
    order.kind === "banner" && order.status === "paid" ? (
      <div className={wide ? "flex gap-2 *:flex-1" : "flex justify-end gap-2"}>
        <Button
          size={wide ? "default" : "sm"}
          variant="outline"
          onClick={() => setRejecting(order)}
        >
          <XIcon aria-hidden />
          拒绝
        </Button>
        <Button
          size={wide ? "default" : "sm"}
          loading={approve.isPending && approve.variables === order.id}
          onClick={() => approve.mutate(order.id)}
        >
          <CheckIcon aria-hidden />
          通过
        </Button>
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <OptionSelect
          label="订单状态"
          className="w-40"
          value={status}
          options={orderStatusOptions}
          allLabel="全部状态"
          onChange={(next) => {
            setStatus(orderStatusOptions.find((option) => option.value === next)?.value);
            setPage(1);
          }}
        />
        {list.data && (
          <span className="text-muted-foreground text-sm tabular-nums">
            共 {total.toLocaleString("zh-CN")} 条
          </span>
        )}
      </div>

      {list.isPending ? (
        <div className="flex flex-col gap-2">
          {["a", "b", "c", "d"].map((key) => (
            <Skeleton key={key} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : list.isError ? (
        <p className="text-destructive-foreground text-sm">加载失败：{list.error.message}</p>
      ) : list.data.rows.length === 0 ? (
        <Empty className="rounded-2xl border border-dashed py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ReceiptIcon />
            </EmptyMedia>
            <EmptyTitle>暂无订单</EmptyTitle>
            <EmptyDescription>
              用户在机器人里用 /promote 购买后，订单会出现在这里。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className={list.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
          <Card className="hidden overflow-hidden p-0 md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">订单</TableHead>
                  <TableHead>内容</TableHead>
                  <TableHead>支付</TableHead>
                  <TableHead>买家</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>时间</TableHead>
                  <TableHead className="pr-4 text-right">
                    <span className="sr-only">操作</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence initial={false}>
                  {list.data.rows.map((order, index) => (
                    <motion.tr
                      key={order.id}
                      layout="position"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: Math.min(index, 12) * 0.015, ease }}
                      className="border-b align-top last:border-b-0"
                    >
                      <TableCell className="pl-4">
                        <div className="font-medium">
                          {order.productName ?? `商品 #${order.productId}`}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-muted-foreground text-xs">
                          <span className="tabular-nums">#{order.id}</span>
                          <Badge variant="outline" size="sm">
                            {productKindLabels[order.kind]} · {order.days} 天
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <PromotionContent username={order.targetUsername} banner={order.banner} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="tabular-nums">
                          {formatAmount(order.amount, order.currency)}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {order.provider ? providerLabels[order.provider] : "—"}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{order.tgUserId}</TableCell>
                      <TableCell>
                        <OrderStatusBadge order={order} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                        <OrderDates order={order} />
                      </TableCell>
                      <TableCell className="pr-4">{actions(order)}</TableCell>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </TableBody>
            </Table>
          </Card>

          <ul className="flex flex-col gap-2 md:hidden">
            <AnimatePresence initial={false}>
              {list.data.rows.map((order, index) => (
                <motion.li
                  key={order.id}
                  layout="position"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(index, 8) * 0.03, ease }}
                >
                  <Card className="gap-3 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {order.productName ?? `商品 #${order.productId}`}
                        </div>
                        <div className="text-muted-foreground text-xs tabular-nums">
                          #{order.id} · {productKindLabels[order.kind]} · {order.days} 天
                        </div>
                      </div>
                      <OrderStatusBadge order={order} />
                    </div>
                    <PromotionContent username={order.targetUsername} banner={order.banner} />
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
                      <span className="tabular-nums">
                        {formatAmount(order.amount, order.currency)}
                        {order.provider && ` · ${providerLabels[order.provider]}`}
                      </span>
                      <span className="font-mono">买家 {order.tgUserId}</span>
                    </div>
                    <div className="text-muted-foreground text-xs">
                      <OrderDates order={order} />
                    </div>
                    {actions(order, true)}
                  </Card>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-muted-foreground text-sm">
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="上一页"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="tabular-nums">
            {page} / {pages}
          </span>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="下一页"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      )}

      <RejectDialog order={rejecting} onClose={() => setRejecting(null)} />
    </div>
  );
}

function OrderStatusBadge({ order }: { order: OrderRow }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant={orderStatusVariants[order.status]}>
        {order.kind === "banner" && order.status === "paid"
          ? "待审核"
          : orderStatusLabels[order.status]}
      </Badge>
      {order.note && (
        <span className="max-w-40 truncate text-muted-foreground text-xs" title={order.note}>
          {order.note}
        </span>
      )}
    </div>
  );
}

function OrderDates({ order }: { order: OrderRow }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span>创建 {dateTime(order.createdAt)}</span>
      {order.paidAt !== null && <span>支付 {dateTime(order.paidAt)}</span>}
      {order.startsAt !== null && order.endsAt !== null && (
        <span>
          投放 {dateTime(order.startsAt)} – {dateTime(order.endsAt)}
        </span>
      )}
    </div>
  );
}

const settleKeys = [
  "orders",
  "promotions",
  "promotionCounts",
  "adminStats",
  "audit",
  "dashboardActivity",
] as const;

function useApproveOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: number) => $approveOrder({ data: { orderId } }),
    onSuccess: (result) =>
      result.ok
        ? toastManager.add({
            type: "success",
            title: "横幅已上线",
            description: "已标记网站待构建",
          })
        : toastManager.add({
            type: "error",
            title: "订单已被处理",
            description: "不再是待审核状态",
          }),
    onError: (error) =>
      toastManager.add({ type: "error", title: "操作失败", description: error.message }),
    onSettled: () => invalidate(queryClient, ...settleKeys),
  });
}

function RejectDialog({ order, onClose }: { order: OrderRow | null; onClose: () => void }) {
  return (
    <Dialog open={order !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup>{order && <RejectForm key={order.id} order={order} />}</DialogPopup>
    </Dialog>
  );
}

function RejectForm({ order }: { order: OrderRow }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const reject = useMutation({
    mutationFn: () => $rejectOrder({ data: { orderId: order.id, reason } }),
    onError: (error) =>
      toastManager.add({ type: "error", title: "操作失败", description: error.message }),
    onSettled: () => invalidate(queryClient, ...settleKeys),
  });
  const result = reject.data;

  if (result) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{result.ok ? "订单已拒绝" : "订单已被处理"}</DialogTitle>
          <DialogDescription>
            {!result.ok
              ? "该订单不再是待审核状态，列表已刷新。"
              : result.refunded
                ? "Stars 已自动退还给买家。"
                : result.provider === "cryptopay"
                  ? "USDT 不会自动退款，请在 @CryptoBot 中手动退款给买家。"
                  : "这笔订单没有自动退款，请手动处理。"}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {result.ok && (
            <Badge variant={result.refunded ? "info" : "warning"}>
              {result.refunded ? "已退款" : "未退款"}
            </Badge>
          )}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button />}>完成</DialogClose>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>拒绝横幅订单 #{order.id}</DialogTitle>
        <DialogDescription>
          {order.provider === "stars"
            ? "拒绝后会自动退还 Stars。"
            : "拒绝后需要手动退款（USDT 不支持自动退款）。"}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex flex-col gap-4">
        {order.banner && <PromotionContent username={order.targetUsername} banner={order.banner} />}
        <div className="flex flex-col gap-2">
          <Label htmlFor="reject-reason">原因（可选，会记入订单备注）</Label>
          <Textarea
            id="reject-reason"
            maxLength={200}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>取消</DialogClose>
        <Button variant="destructive" loading={reject.isPending} onClick={() => reject.mutate()}>
          拒绝{order.provider === "stars" ? "并退款" : ""}
        </Button>
      </DialogFooter>
    </>
  );
}
