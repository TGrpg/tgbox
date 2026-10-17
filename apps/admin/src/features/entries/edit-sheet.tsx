import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/coss/ui/button.tsx";
import { Checkbox } from "@/components/coss/ui/checkbox.tsx";
import { Input } from "@/components/coss/ui/input.tsx";
import { Label } from "@/components/coss/ui/label.tsx";
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/coss/ui/sheet.tsx";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import { useIsMobile } from "@/features/entries/use-is-mobile.ts";
import { $getEntryTags, type EntryRow } from "@/functions/entries.ts";
import { taxonomyQueryOptions } from "@/functions/taxonomy.ts";
import { queryKeys } from "@/lib/query-keys.ts";
import { checkStartPayloadEdit } from "./edit.ts";
import { kindLabel } from "./labels.ts";
import { useEditEntry, useSetEntryStartPayload } from "./mutations.ts";
import { OptionSelect } from "./option-select.tsx";
import { TagPicker } from "./tag-picker.tsx";

/** Edit drawer: taxonomy, promotion and admin-curated bot payload. */
export function EditEntrySheet({
  entry,
  onClose,
}: {
  entry: EntryRow | null;
  onClose: () => void;
}) {
  const mobile = useIsMobile();
  return (
    <Sheet open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetPopup side={mobile ? "bottom" : "right"}>
        {entry && <EditForm key={entry.id} entry={entry} onClose={onClose} />}
      </SheetPopup>
    </Sheet>
  );
}

function EditForm({ entry, onClose }: { entry: EntryRow; onClose: () => void }) {
  const taxonomy = useQuery(taxonomyQueryOptions());
  // Tags come fresh from the entry (the list row may be stale after another edit).
  const tags = useQuery({
    queryKey: [...queryKeys.entryTags, entry.id],
    queryFn: ({ signal }) => $getEntryTags({ data: { id: entry.id }, signal }),
    staleTime: 0,
  });
  const [categoryId, setCategoryId] = useState(entry.categoryId);
  const [tagIds, setTagIds] = useState<number[] | null>(null);
  const [promoted, setPromoted] = useState(entry.promoted);
  const edit = useEditEntry(onClose);
  const payload = useSetEntryStartPayload();
  const [startPayload, setStartPayload] = useState(entry.startPayload ?? "");
  const payloadError = entry.kind === "bot" ? checkStartPayloadEdit(startPayload) : null;
  const selectedTags = tagIds ?? tags.data ?? entry.tagIds;

  const categories = (taxonomy.data?.categories ?? []).filter((row) => row.kind === entry.kind);

  return (
    <>
      <SheetHeader>
        <SheetTitle>编辑条目</SheetTitle>
        <SheetDescription>
          {entry.title} · @{entry.username} · {kindLabel[entry.kind]}
        </SheetDescription>
      </SheetHeader>
      <SheetPanel className="flex flex-col gap-6">
        {taxonomy.isPending || tags.isPending ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Label>分类</Label>
              <OptionSelect
                label="分类"
                value={String(categoryId)}
                options={categories.map((row) => ({ value: String(row.id), label: row.nameZh }))}
                onChange={(value) => value && setCategoryId(Number(value))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>标签</Label>
              <TagPicker
                tags={taxonomy.data?.tags ?? []}
                selected={selectedTags}
                onChange={setTagIds}
              />
            </div>
            {entry.kind === "bot" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="start-payload">Start 参数</Label>
                <Input
                  id="start-payload"
                  value={startPayload}
                  aria-invalid={payloadError !== null}
                  aria-describedby="start-payload-help start-payload-error"
                  onChange={(event) => setStartPayload(event.target.value)}
                />
                <p id="start-payload-help" className="text-xs text-muted-foreground">
                  仅在 bot
                  主人要求时填写。会附加到全站所有打开链接：t.me/&lt;username&gt;?start=…；留空即清除。
                </p>
                {payloadError && (
                  <p id="start-payload-error" role="alert" className="text-xs text-destructive">
                    {payloadError}
                  </p>
                )}
              </div>
            )}
            <Label className="flex items-center gap-2">
              <Checkbox
                checked={promoted || entry.pinnedByPromotion}
                disabled={entry.pinnedByPromotion}
                onCheckedChange={(checked) => setPromoted(checked)}
              />
              推广
            </Label>
            {entry.pinnedByPromotion && (
              <p className="-mt-2 text-xs text-muted-foreground">
                该条目有投放中的付费置顶，网站每次构建都会重新置顶它。要下线请到推广页结束这笔投放。
              </p>
            )}
          </>
        )}
      </SheetPanel>
      <SheetFooter>
        <Button variant="ghost" onClick={onClose}>
          取消
        </Button>
        <Button
          loading={edit.isPending || payload.isPending}
          disabled={
            taxonomy.isPending ||
            tags.isPending ||
            payloadError !== null ||
            edit.isPending ||
            payload.isPending
          }
          onClick={async () => {
            let startPayloadChanged = false;
            const next = startPayload.trim() === "" ? null : startPayload;
            if (entry.kind === "bot" && next !== entry.startPayload) {
              try {
                const result = await payload.mutateAsync({ id: entry.id, startPayload: next });
                if (!result.ok) return;
                startPayloadChanged = result.changed;
              } catch {
                return;
              }
            }
            edit.mutate({
              id: entry.id,
              categoryId,
              tagIds: selectedTags,
              promoted,
              startPayloadChanged,
            });
          }}
        >
          保存
        </Button>
      </SheetFooter>
    </>
  );
}
