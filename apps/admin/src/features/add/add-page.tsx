import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { EntryPreview } from "@tgbox/core";
import { type EntryKind, entryKinds, type Suggestion } from "@tgbox/shared";
import { BadgeCheckIcon, CircleAlertIcon, SearchIcon, SendIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/coss/ui/avatar.tsx";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import { Card } from "@/components/coss/ui/card.tsx";
import { Input } from "@/components/coss/ui/input.tsx";
import { Label } from "@/components/coss/ui/label.tsx";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import { toastManager } from "@/components/coss/ui/toast.tsx";
import { PageHeader } from "@/components/shell/page-header.tsx";
import {
  formatCount,
  kindLabel,
  langLabel,
  livenessLabel,
  livenessVariant,
  statusLabel,
} from "@/features/entries/labels.ts";
import { OptionSelect } from "@/features/entries/option-select.tsx";
import { TagPicker } from "@/features/entries/tag-picker.tsx";
import { $listEntry, $previewEntry } from "@/functions/add.ts";
import { taxonomyQueryOptions } from "@/functions/taxonomy.ts";
import { invalidate } from "@/lib/query-keys.ts";
import { addEntryErrorText } from "./errors.ts";

type Preview = Extract<EntryPreview, { ok: true }>;
const ease = [0.16, 1, 0.3, 1] as const;

export function AddPage() {
  const [input, setInput] = useState("");
  const preview = useMutation({
    mutationFn: (username: string) => $previewEntry({ data: { username } }),
    onError: (error) =>
      toastManager.add({ type: "error", title: "抓取失败", description: error.message }),
  });

  return (
    <>
      <PageHeader
        title="手动收录"
        description="输入用户名或链接，自动抓取资料后选择分类和标签直接上线。"
      />
      <div className="flex max-w-2xl flex-col gap-4">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (input.trim()) preview.mutate(input.trim());
          }}
        >
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="@username 或 https://t.me/username"
            aria-label="用户名或链接"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button type="submit" loading={preview.isPending} disabled={!input.trim()}>
            <SearchIcon /> 抓取
          </Button>
        </form>

        {preview.isPending && <Skeleton className="h-48 rounded-2xl" />}
        <AnimatePresence mode="wait">
          {preview.data && !preview.isPending && (
            <motion.div
              key={preview.data.ok ? preview.data.username : "invalid"}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3, ease }}
            >
              {preview.data.ok ? (
                <PreviewResult preview={preview.data} onListed={() => preview.reset()} />
              ) : (
                <Problem title={addEntryErrorText[preview.data.error]} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

function Problem({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <Card className="flex-row items-start gap-3 border-destructive/30 bg-destructive/4 p-4 text-sm">
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive-foreground" aria-hidden />
      <div className="flex flex-col gap-1">
        <span className="font-medium text-destructive-foreground">{title}</span>
        {children}
      </div>
    </Card>
  );
}

function PreviewResult({ preview, onListed }: { preview: Preview; onListed: () => void }) {
  if (preview.existing) {
    return (
      <Problem title={`@${preview.username} 已收录（${statusLabel[preview.existing.status]}）`}>
        <span className="text-muted-foreground">
          {preview.existing.title} ·{" "}
          <Link
            to="/entries"
            search={{ q: preview.username }}
            className="underline underline-offset-4"
          >
            在条目管理中查看
          </Link>
        </span>
      </Problem>
    );
  }
  if (preview.pendingSubmissionId !== null) {
    return (
      <Problem title={addEntryErrorText.pending_submission}>
        <Link to="/review" className="text-muted-foreground underline underline-offset-4">
          前往审核队列（提交 #{preview.pendingSubmissionId}）
        </Link>
      </Problem>
    );
  }
  if (preview.blacklisted) return <Problem title={addEntryErrorText.blacklisted} />;

  const snap = preview.snapshot;
  if (!snap) return null;
  const kind = entryKinds.find((value) => value === snap.kind);
  const problem =
    snap.kind === "user"
      ? addEntryErrorText.user_account
      : snap.liveness === "not_found"
        ? addEntryErrorText.not_found
        : snap.liveness === "banned"
          ? addEntryErrorText.banned
          : snap.liveness !== "active" || !kind
            ? addEntryErrorText.unavailable
            : null;

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-4 p-4">
        <div className="flex items-start gap-4">
          <Avatar className="size-16 bg-muted text-lg">
            {snap.avatarUrl && <AvatarImage src={snap.avatarUrl} alt="" />}
            <AvatarFallback>
              {(snap.title ?? preview.username).slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-1.5 font-semibold text-lg">
              <span className="truncate">{snap.title ?? preview.username}</span>
              {snap.verified && (
                <BadgeCheckIcon
                  className="size-4 shrink-0 text-info-foreground"
                  aria-label="已认证"
                />
              )}
            </div>
            <a
              href={`https://t.me/${preview.username}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground text-sm"
            >
              <SendIcon className="size-3.5" aria-hidden />@{preview.username}
            </a>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge variant={livenessVariant[snap.liveness]}>{livenessLabel[snap.liveness]}</Badge>
              {snap.kind && snap.kind !== "user" && (
                <Badge variant="outline">{kindLabel[snap.kind]}</Badge>
              )}
              {snap.kind === "user" && <Badge variant="error">个人账号</Badge>}
              {snap.lang && <Badge variant="outline">{langLabel[snap.lang] ?? snap.lang}</Badge>}
              {(snap.members ?? snap.monthlyUsers) !== null && (
                <Badge variant="secondary">
                  {formatCount(snap.members ?? snap.monthlyUsers)}{" "}
                  {snap.kind === "bot" ? "月活" : "成员"}
                </Badge>
              )}
              {snap.online !== null && (
                <Badge variant="secondary">{formatCount(snap.online)} 在线</Badge>
              )}
            </div>
          </div>
        </div>
        {snap.description && (
          <p className="line-clamp-4 whitespace-pre-line text-muted-foreground text-sm">
            {snap.description}
          </p>
        )}
        {snap.posts.length > 0 && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <span className="text-muted-foreground text-xs">最近消息</span>
            {snap.posts.map((post) => (
              <p key={post.id} className="line-clamp-2 text-sm">
                <span className="me-2 text-muted-foreground text-xs tabular-nums">
                  {new Date(post.date).toLocaleDateString("zh-CN")}
                </span>
                {post.text || "（媒体消息）"}
              </p>
            ))}
          </div>
        )}
      </Card>

      {problem ? (
        <Problem title={problem} />
      ) : (
        kind && (
          <ListForm
            username={preview.username}
            kind={kind}
            suggestion={preview.suggestion}
            onListed={onListed}
          />
        )
      )}
    </div>
  );
}

function ListForm({
  username,
  kind,
  suggestion,
  onListed,
}: {
  username: string;
  kind: EntryKind;
  suggestion: Suggestion;
  onListed: () => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const taxonomy = useQuery(taxonomyQueryOptions());
  const [categorySlug, setCategorySlug] = useState<string>();
  const [tagIds, setTagIds] = useState<number[]>([]);
  const categories = (taxonomy.data?.categories ?? []).filter((row) => row.kind === kind);
  const tags = taxonomy.data?.tags ?? [];

  // The guess is applied once the taxonomy has loaded, and only while the admin has not chosen
  // anything: it is a starting point, never something that reappears over an edit.
  const suggestedSlug = categories.find((row) => row.id === suggestion.categoryId)?.slug;
  const [applied, setApplied] = useState(false);
  if (!applied && taxonomy.data) {
    setApplied(true);
    if (suggestedSlug) setCategorySlug(suggestedSlug);
    if (suggestion.tagIds.length > 0) setTagIds(suggestion.tagIds);
  }

  const list = useMutation({
    mutationFn: (input: { categorySlug: string; tagSlugs: string[] }) =>
      $listEntry({ data: { username, ...input } }),
    onError: (error) =>
      toastManager.add({ type: "error", title: "上线失败", description: error.message }),
    onSuccess: async (result) => {
      if (!result.ok) {
        toastManager.add({
          type: "error",
          title: "上线失败",
          description: addEntryErrorText[result.error],
        });
        return;
      }
      toastManager.add({
        type: "success",
        title: `@${username} 已上线`,
        description: "站点将在下次构建后更新",
        actionProps: {
          children: "查看条目",
          onClick: () => navigate({ to: "/entries", search: { q: username } }),
        },
      });
      await invalidate(client, "entries", "adminStats", "dashboardActivity", "audit");
      onListed();
    },
  });

  if (taxonomy.isPending) return <Skeleton className="h-40 rounded-2xl" />;

  return (
    <Card className="gap-5 p-4">
      <div className="flex flex-col gap-2">
        <Label>分类（{kindLabel[kind]}）</Label>
        <OptionSelect
          label="选择分类"
          value={categorySlug}
          options={categories.map((row) => ({ value: row.slug, label: row.nameZh }))}
          onChange={setCategorySlug}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>标签</Label>
        <TagPicker tags={tags} selected={tagIds} onChange={setTagIds} />
        {suggestion.source !== "none" && (
          <p className="text-muted-foreground text-xs">
            ✨ 分类和标签是根据简介猜的，请确认或改掉。
          </p>
        )}
      </div>
      <Button
        size="lg"
        loading={list.isPending}
        disabled={!categorySlug}
        onClick={() =>
          categorySlug &&
          list.mutate({
            categorySlug,
            tagSlugs: tagIds.flatMap((id) => tags.find((tag) => tag.id === id)?.slug ?? []),
          })
        }
      >
        直接上线
      </Button>
    </Card>
  );
}
