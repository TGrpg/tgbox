import { type FriendLink, FriendLink as FriendLinkSchema } from "@tgbox/shared";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/coss/ui/button.tsx";
import { Card } from "@/components/coss/ui/card.tsx";
import { Input } from "@/components/coss/ui/input.tsx";

const blank: FriendLink = { name: "", url: "https://", descZh: "", descEn: "" };

export function LinkListEditor({
  initial,
  title,
  hint,
  emptyText,
  maxLinks,
  saving,
  onSave,
}: {
  initial: FriendLink[];
  title: string;
  hint: string;
  emptyText: string;
  maxLinks: number;
  saving: boolean;
  onSave: (links: FriendLink[]) => void;
}) {
  const [draft, setLinks] = useState<FriendLink[] | null>(null);
  const links = draft ?? initial;
  const cleaned = links.map((link) => ({
    name: link.name.trim(),
    url: link.url.trim(),
    descZh: link.descZh.trim(),
    descEn: link.descEn.trim(),
  }));
  const invalid = cleaned.map((link) => !FriendLinkSchema.safeParse(link).success);
  const dirty = JSON.stringify(cleaned) !== JSON.stringify(initial);
  const update = (index: number, patch: Partial<FriendLink>) =>
    setLinks(links.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...links];
    const [item] = next.splice(index, 1);
    if (item) next.splice(index + by, 0, item);
    setLinks(next);
  };

  return (
    <fieldset disabled={saving} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-base">
          {title}
          <span className="ms-2 font-normal text-muted-foreground text-sm tabular-nums">
            {links.length} / {maxLinks}
          </span>
        </h2>
        <p className="basis-full text-muted-foreground text-sm sm:order-last">{hint}</p>
        <div className="ms-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={links.length >= maxLinks}
            onClick={() => setLinks([...links, blank])}
          >
            <PlusIcon aria-hidden />
            添加
          </Button>
          <Button
            size="sm"
            disabled={!dirty || invalid.some(Boolean)}
            loading={saving}
            onClick={() => onSave(cleaned)}
          >
            <SaveIcon aria-hidden />
            保存
          </Button>
        </div>
      </div>
      {links.length === 0 ? (
        <Card className="items-center p-10 text-center text-muted-foreground text-sm">
          {emptyText}
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {links.map((link, index) => (
            <Card
              key={index}
              className="grid gap-2 p-3 sm:grid-cols-[1fr_1.4fr_auto]"
              data-invalid={invalid[index] || undefined}
            >
              <Input
                aria-label="名称"
                placeholder="名称"
                maxLength={40}
                value={link.name}
                onChange={(event) => update(index, { name: event.target.value })}
              />
              <Input
                aria-label="网址"
                placeholder="https://"
                maxLength={200}
                value={link.url}
                aria-invalid={invalid[index] && !link.url.startsWith("https://") ? true : undefined}
                onChange={(event) => update(index, { url: event.target.value })}
              />
              <div className="row-span-2 flex items-start justify-end gap-1 sm:flex-col">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="上移"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="下移"
                  disabled={index === links.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`删除 ${link.name}`}
                  onClick={() => setLinks(links.filter((_, i) => i !== index))}
                >
                  <Trash2Icon />
                </Button>
              </div>
              <Input
                aria-label="中文简介"
                placeholder="中文简介（可选）"
                maxLength={120}
                value={link.descZh}
                onChange={(event) => update(index, { descZh: event.target.value })}
              />
              <Input
                aria-label="英文简介"
                placeholder="English description (optional)"
                maxLength={120}
                value={link.descEn}
                onChange={(event) => update(index, { descEn: event.target.value })}
              />
            </Card>
          ))}
        </div>
      )}
    </fieldset>
  );
}
