import type { EntryKind } from "@tgbox/shared";
import { EyeIcon, EyeOffIcon, StarIcon, StarOffIcon, Trash2Icon, XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/coss/ui/alert-dialog.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import type { EntryRow } from "@/functions/entries.ts";
import { useSetCategory, useSetPromoted, useSetStatus } from "./mutations.ts";
import { OptionSelect } from "./option-select.tsx";

type Category = { id: number; kind: EntryKind; nameZh: string };

/** Floating bulk-action bar for the selected rows of the current page. */
export function BulkBar({
  selected,
  categories,
  onClear,
}: {
  selected: EntryRow[];
  categories: Category[];
  onClear: () => void;
}) {
  const status = useSetStatus();
  const promote = useSetPromoted();
  const category = useSetCategory();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const ids = selected.map((row) => row.id);
  const kinds = new Set(selected.map((row) => row.kind));
  const [onlyKind] = kinds.size === 1 ? [...kinds] : [];
  const busy = status.isPending || promote.isPending || category.isPending;

  const done = { onSuccess: onClear };

  return (
    <>
      <AnimatePresence>
        {selected.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 md:inset-x-auto md:bottom-6 md:left-[calc(50%+7.5rem)] md:-translate-x-1/2"
          >
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-popover p-2 shadow-float">
              <span className="px-2 font-medium text-sm tabular-nums">已选 {selected.length}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => status.mutate({ ids, status: "hidden_by_admin" }, done)}
              >
                <EyeOffIcon /> 隐藏
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => status.mutate({ ids, status: "approved" }, done)}
              >
                <EyeIcon /> 恢复
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => promote.mutate({ ids, promoted: true }, done)}
              >
                <StarIcon /> 推广
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => promote.mutate({ ids, promoted: false }, done)}
              >
                <StarOffIcon /> 取消推广
              </Button>
              <OptionSelect
                label={onlyKind ? "设置分类" : "设置分类（需同一类型）"}
                value={undefined}
                disabled={!onlyKind || busy}
                options={categories
                  .filter((row) => row.kind === onlyKind)
                  .map((row) => ({ value: String(row.id), label: row.nameZh }))}
                onChange={(value) =>
                  value && category.mutate({ ids, categoryId: Number(value) }, done)
                }
                className="w-36"
              />
              <Button
                size="sm"
                variant="destructive-outline"
                disabled={busy}
                onClick={() => setConfirmRemove(true)}
              >
                <Trash2Icon /> 删除
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="取消选择" onClick={onClear}>
                <XIcon />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 {selected.length} 个条目？</AlertDialogTitle>
            <AlertDialogDescription>
              条目将从站点下线（状态设为「已删除」），之后仍可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>取消</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmRemove(false);
                status.mutate({ ids, status: "removed" }, done);
              }}
            >
              删除
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
