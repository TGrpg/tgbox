import { LockIcon, PlusIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type KeyboardEvent, type ReactNode, useId, useState } from "react";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import { Input } from "@/components/coss/ui/input.tsx";
import { Label } from "@/components/coss/ui/label.tsx";
import { Switch } from "@/components/coss/ui/switch.tsx";
import { OptionSelect } from "@/features/entries/option-select.tsx";
import type { SettingsView } from "@/server/settings.ts";
import { addAdminIds, isChatId } from "./admin-ids.ts";

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-destructive-foreground text-xs">{error}</p>
      ) : (
        hint && <p className="text-muted-foreground text-xs">{hint}</p>
      )}
    </div>
  );
}

export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Label className="flex items-center justify-between gap-4 rounded-xl border p-3">
      <span className="flex flex-col gap-1">
        {label}
        {hint && <span className="font-normal text-muted-foreground text-xs">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </Label>
  );
}

type Chat = SettingsView["reviewChats"][number];

const chatLabel = (chat: Chat) =>
  chat.username ? `${chat.title} · @${chat.username}` : chat.title;

/** Pick a chat the bot knows about, or type any chat id. Empty = null. */
export function ChatField({
  label,
  value,
  chats,
  emptyLabel,
  hint,
  onChange,
}: {
  label: string;
  value: string | null;
  chats: Chat[];
  emptyLabel: string;
  hint: ReactNode;
  onChange: (value: string | null) => void;
}) {
  const id = useId();
  const known = value === null || chats.some((chat) => chat.chatId === value);
  const options = [
    ...chats.map((chat) => ({ value: chat.chatId, label: chatLabel(chat) })),
    ...(known || value === null ? [] : [{ value, label: `手动填写 · ${value}` }]),
  ];
  const invalid = value !== null && !isChatId(value);
  return (
    <Field
      label={label}
      htmlFor={id}
      hint={hint}
      error={invalid ? "聊天 ID 是数字，群组 / 频道通常以 -100 开头" : null}
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
        <OptionSelect
          label={label}
          value={value ?? undefined}
          options={options}
          allLabel={emptyLabel}
          onChange={(next) => onChange(next ?? null)}
        />
        <Input
          id={id}
          placeholder="或手动填写 ID"
          inputMode="numeric"
          value={value ?? ""}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value.trim() || null)}
        />
      </div>
    </Field>
  );
}

export function AdminIdsField({
  value,
  superAdminIds,
  onChange,
}: {
  value: string[];
  superAdminIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    if (!text.trim()) return;
    const result = addAdminIds(text, value, superAdminIds);
    onChange(result.ids);
    setText(result.invalid.join(" "));
    setError(result.invalid.length > 0 ? `不是用户 ID：${result.invalid.join("、")}` : null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && text === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <Field
      label="管理员"
      htmlFor={id}
      hint="填写 Telegram 用户 ID，回车添加。带锁的是 wrangler ADMIN_IDS 里的超级管理员，不能在这里移除。"
      error={error}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {superAdminIds.map((adminId) => (
          <Badge key={adminId} variant="secondary" size="lg" title="超级管理员">
            <LockIcon aria-hidden />
            <span className="font-mono">{adminId}</span>
          </Badge>
        ))}
        <AnimatePresence initial={false}>
          {value.map((adminId) => (
            <motion.span
              key={adminId}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.15 }}
            >
              <Badge variant="outline" size="lg">
                <span className="font-mono">{adminId}</span>
                <button
                  type="button"
                  className="-me-0.5 cursor-pointer rounded-sm opacity-70 hover:opacity-100"
                  aria-label={`移除管理员 ${adminId}`}
                  onClick={() => onChange(value.filter((item) => item !== adminId))}
                >
                  <XIcon aria-hidden />
                </button>
              </Badge>
            </motion.span>
          ))}
        </AnimatePresence>
        {superAdminIds.length === 0 && value.length === 0 && (
          <span className="text-muted-foreground text-sm">暂无管理员</span>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          id={id}
          inputMode="numeric"
          placeholder="用户 ID，如 123456789"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={commit}
        />
        <Button type="button" variant="outline" onClick={commit}>
          <PlusIcon aria-hidden />
          添加
        </Button>
      </div>
    </Field>
  );
}
