import {
  EllipsisVerticalIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  PencilIcon,
  RefreshCwIcon,
  SendIcon,
  StarIcon,
  StarOffIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/coss/ui/button.tsx";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/coss/ui/menu.tsx";
import { Spinner } from "@/components/coss/ui/spinner.tsx";
import type { EntryRow } from "@/functions/entries.ts";
import { sitePageUrl, telegramUrl } from "./labels.ts";
import { useRefreshEntry, useSetPromoted, useSetStatus } from "./mutations.ts";

export function RowActions({
  entry,
  siteUrl,
  onEdit,
}: {
  entry: EntryRow;
  siteUrl: string;
  onEdit: (entry: EntryRow) => void;
}) {
  const refresh = useRefreshEntry();
  const status = useSetStatus();
  const promote = useSetPromoted();
  const ids = [entry.id];
  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={`${entry.title} 的操作`} />}
      >
        {refresh.isPending ? <Spinner /> : <EllipsisVerticalIcon />}
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem onClick={() => onEdit(entry)}>
          <PencilIcon /> 编辑分类与标签
        </MenuItem>
        <MenuItem disabled={refresh.isPending} onClick={() => refresh.mutate(entry.id)}>
          <RefreshCwIcon /> 立即刷新
        </MenuItem>
        <MenuItem onClick={() => promote.mutate({ ids, promoted: !entry.promoted })}>
          {entry.promoted ? <StarOffIcon /> : <StarIcon />}
          {entry.promoted ? "取消推广" : "设为推广"}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          render={
            <a href={sitePageUrl(siteUrl, entry.username)} target="_blank" rel="noreferrer" />
          }
        >
          <ExternalLinkIcon /> 打开站点页面
        </MenuItem>
        <MenuItem
          render={<a href={telegramUrl(entry.username)} target="_blank" rel="noreferrer" />}
        >
          <SendIcon /> 打开 t.me
        </MenuItem>
        <MenuSeparator />
        {entry.status === "approved" ? (
          <MenuItem onClick={() => status.mutate({ ids, status: "hidden_by_admin" })}>
            <EyeOffIcon /> 隐藏
          </MenuItem>
        ) : (
          <MenuItem onClick={() => status.mutate({ ids, status: "approved" })}>
            <EyeIcon /> 恢复上线
          </MenuItem>
        )}
        {entry.status !== "removed" && (
          <MenuItem variant="destructive" onClick={() => status.mutate({ ids, status: "removed" })}>
            <Trash2Icon /> 删除
          </MenuItem>
        )}
      </MenuPopup>
    </Menu>
  );
}
