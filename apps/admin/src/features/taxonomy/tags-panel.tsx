import { PencilIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type FormEvent, useState } from "react";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import { Card } from "@/components/coss/ui/card.tsx";
import { Input } from "@/components/coss/ui/input.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/coss/ui/table.tsx";
import type { TaxonomyTag } from "@/functions/taxonomy.ts";
import { ConfirmDelete } from "./confirm-delete.tsx";
import { useTaxonomyMutations } from "./use-taxonomy-mutations.ts";

type Mutations = ReturnType<typeof useTaxonomyMutations>;
type TagValues = { slug: string; nameZh: string; nameEn: string };

const matches = (tag: TaxonomyTag, q: string) =>
  [tag.slug, tag.nameZh, tag.nameEn].some((value) => value.toLowerCase().includes(q));

export function TagsPanel({ tags }: { tags: TaxonomyTag[] }) {
  const mutations = useTaxonomyMutations();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const query = q.trim().toLowerCase();
  const visible = query ? tags.filter((tag) => matches(tag, query)) : tags;

  const save = (values: TagValues, id?: number) =>
    mutations.upsertTag.mutate(
      { ...values, id },
      { onSuccess: (result) => result.ok && setEditing(null) },
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="搜索标签"
            placeholder="搜索标签"
            className="[&_input]:pl-8"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        </div>
        <span className="text-muted-foreground text-sm tabular-nums">
          {visible.length} / {tags.length}
        </span>
        <Button className="ml-auto" size="sm" onClick={() => setEditing("new")}>
          <PlusIcon aria-hidden />
          新增标签
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {editing === "new" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <Card className="p-0">
              <TagForm
                initial={{ slug: "", nameZh: "", nameEn: "" }}
                pending={mutations.upsertTag.isPending}
                onCancel={() => setEditing(null)}
                onSubmit={(values) => save(values)}
              />
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop: table */}
      <Card className="hidden overflow-hidden p-0 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">slug</TableHead>
              <TableHead>中文名</TableHead>
              <TableHead>英文名</TableHead>
              <TableHead className="text-right">条目数</TableHead>
              <TableHead className="w-24 pr-4 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <AnimatePresence initial={false}>
              {visible.map((tag) =>
                editing === tag.id ? (
                  <TableRow key={tag.id}>
                    <TableCell colSpan={5} className="p-0">
                      <TagForm
                        initial={tag}
                        pending={mutations.upsertTag.isPending}
                        onCancel={() => setEditing(null)}
                        onSubmit={(values) => save(values, tag.id)}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  <motion.tr
                    key={tag.id}
                    layout="position"
                    exit={{ opacity: 0 }}
                    className="border-b last:border-b-0"
                  >
                    <TableCell className="pl-4 font-mono text-xs">{tag.slug}</TableCell>
                    <TableCell>{tag.nameZh}</TableCell>
                    <TableCell>{tag.nameEn}</TableCell>
                    <TableCell className="text-right tabular-nums">{tag.entries}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <TagActions
                        tag={tag}
                        onEdit={() => setEditing(tag.id)}
                        mutations={mutations}
                      />
                    </TableCell>
                  </motion.tr>
                ),
              )}
            </AnimatePresence>
          </TableBody>
        </Table>
        {visible.length === 0 && <Empty />}
      </Card>

      {/* Mobile: cards */}
      <div className="flex flex-col gap-2 md:hidden">
        <AnimatePresence initial={false}>
          {visible.map((tag) => (
            <motion.div
              key={tag.id}
              layout="position"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
            >
              <Card className="gap-0 p-0">
                {editing === tag.id ? (
                  <TagForm
                    initial={tag}
                    pending={mutations.upsertTag.isPending}
                    onCancel={() => setEditing(null)}
                    onSubmit={(values) => save(values, tag.id)}
                  />
                ) : (
                  <div className="flex items-center gap-2 py-2 pr-2 pl-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-sm">
                        {tag.nameZh} <span className="text-muted-foreground">· {tag.nameEn}</span>
                      </div>
                      <div className="truncate font-mono text-muted-foreground text-xs">
                        {tag.slug}
                      </div>
                    </div>
                    <Badge variant="outline" className="tabular-nums">
                      {tag.entries}
                    </Badge>
                    <TagActions tag={tag} onEdit={() => setEditing(tag.id)} mutations={mutations} />
                  </div>
                )}
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
        {visible.length === 0 && <Empty />}
      </div>
    </div>
  );
}

function Empty() {
  return <p className="px-4 py-8 text-center text-muted-foreground text-sm">没有匹配的标签</p>;
}

function TagActions({
  tag,
  onEdit,
  mutations,
}: {
  tag: TaxonomyTag;
  onEdit: () => void;
  mutations: Mutations;
}) {
  return (
    <div className="inline-flex gap-1">
      <Button size="icon-sm" variant="ghost" aria-label={`编辑 ${tag.slug}`} onClick={onEdit}>
        <PencilIcon aria-hidden />
      </Button>
      <ConfirmDelete
        title={`删除标签「${tag.nameZh}」？`}
        description={
          tag.entries > 0
            ? `${tag.entries} 个条目正在使用该标签，删除后会从这些条目上移除，站点将重新构建。`
            : "没有条目使用该标签。"
        }
        onConfirm={() => mutations.deleteTag.mutate(tag.id)}
        trigger={
          <Button size="icon-sm" variant="ghost" aria-label={`删除 ${tag.slug}`}>
            <Trash2Icon aria-hidden />
          </Button>
        }
      />
    </div>
  );
}

function TagForm({
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: TagValues;
  pending: boolean;
  onSubmit: (values: TagValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<TagValues>({
    slug: initial.slug,
    nameZh: initial.nameZh,
    nameEn: initial.nameEn,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(values);
  };
  return (
    <form onSubmit={submit} className="grid gap-2 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
      <Input
        aria-label="slug"
        placeholder="slug"
        className="font-mono"
        value={values.slug}
        onChange={(event) => setValues({ ...values, slug: event.target.value })}
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        required
      />
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
      <div className="flex justify-end gap-2">
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
