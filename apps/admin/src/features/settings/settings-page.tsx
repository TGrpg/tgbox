import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type BotSettings,
  MAX_POST_BLOCKLIST,
  type PaymentSettings,
  type SiteSettings,
  TRON_ADDRESS_RE,
} from "@tgbox/shared";
import {
  BotIcon,
  CheckIcon,
  CopyIcon,
  CreditCardIcon,
  GlobeIcon,
  type LucideIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Badge } from "@/components/coss/ui/badge.tsx";
import { Button } from "@/components/coss/ui/button.tsx";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/coss/ui/card.tsx";
import { Input } from "@/components/coss/ui/input.tsx";
import { Skeleton } from "@/components/coss/ui/skeleton.tsx";
import { Textarea } from "@/components/coss/ui/textarea.tsx";
import { toastManager } from "@/components/coss/ui/toast.tsx";
import { OptionSelect } from "@/features/entries/option-select.tsx";
import {
  $setCryptoPayToken,
  $setTronGridKey,
  $updateSettings,
  settingsQueryOptions,
} from "@/functions/settings.ts";
import { invalidate } from "@/lib/query-keys.ts";
import type { SettingsInput, SettingsView } from "@/server/settings.ts";
import { isChatId, normalizeSupportUsername } from "./admin-ids.ts";
import { AdminIdsField, ChatField, Field, SwitchRow } from "./fields.tsx";
import { formatPostBlocklist, parsePostBlocklist } from "./post-blocklist.ts";

const ease = [0.16, 1, 0.3, 1] as const;

export function SettingsPage() {
  const view = useQuery(settingsQueryOptions());

  if (view.isPending) {
    return (
      <div className="flex flex-col gap-4">
        {["a", "b", "c"].map((key) => (
          <Skeleton key={key} className="h-72 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (view.isError) {
    return <p className="text-destructive-foreground text-sm">加载失败：{view.error.message}</p>;
  }

  const { settings } = view.data;
  // Each section remounts when its saved value changes, so its form starts from the server state.
  const sections = [
    <BotSection key={`bot:${JSON.stringify(settings.bot)}`} view={view.data} />,
    <SiteSection key={`site:${JSON.stringify(settings.site)}`} initial={settings.site} />,
    <PaymentsSection
      key={`payments:${JSON.stringify(settings.payments)}`}
      initial={settings.payments}
      view={view.data}
    />,
    <StatusSection key="status" view={view.data} />,
  ];

  return (
    <div className="flex flex-col gap-4">
      {sections.map((section, index) => (
        <motion.div
          key={section.key}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.04, duration: 0.3, ease }}
        >
          {section}
        </motion.div>
      ))}
    </div>
  );
}

function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SettingsInput) => $updateSettings({ data }),
    onSuccess: (result, input) => {
      if (!result.ok) {
        toastManager.add({ type: "error", title: "设置无效", description: "请检查填写的内容" });
      } else if (!result.changed) {
        toastManager.add({ type: "info", title: "没有改动" });
      } else {
        toastManager.add({
          type: "success",
          title: "设置已保存",
          description: input.key === "site" ? "已标记网站待构建" : undefined,
        });
      }
    },
    onError: () =>
      toastManager.add({ type: "error", title: "保存失败", description: "请检查填写的内容" }),
    onSettled: (_result, _error, input) =>
      invalidate(
        queryClient,
        "settings",
        "audit",
        "dashboardActivity",
        ...(input.key === "site" ? (["adminStats"] as const) : []),
      ),
  });
}

function Section({
  icon: Icon,
  title,
  description,
  children,
  footer,
  onSubmit,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onSubmit?: () => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit?.();
  };
  return (
    <Card render={onSubmit ? <form onSubmit={submit} /> : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4.5 text-muted-foreground" aria-hidden />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardPanel className="flex flex-col gap-5">{children}</CardPanel>
      {footer && <CardFooter className="justify-end gap-3">{footer}</CardFooter>}
    </Card>
  );
}

function SaveButton({
  dirty,
  pending,
  disabled,
}: {
  dirty: boolean;
  pending: boolean;
  disabled?: boolean;
}) {
  return (
    <>
      {dirty && <span className="text-muted-foreground text-xs">有未保存的修改</span>}
      <Button type="submit" loading={pending} disabled={!dirty || disabled}>
        保存
      </Button>
    </>
  );
}

/* --------------------------------------------------------------------- bot */

const reviewModeOptions = [
  { value: "chat", label: "群组" },
  { value: "admins", label: "每位管理员私聊" },
];

function BotSection({ view }: { view: SettingsView }) {
  const initial = view.settings.bot;
  const [value, setValue] = useState<BotSettings>(initial);
  const [support, setSupport] = useState(initial.supportUsername ?? "");
  const save = useSaveSettings();
  const patch = (next: Partial<BotSettings>) => setValue((current) => ({ ...current, ...next }));

  const candidate: BotSettings = { ...value, supportUsername: normalizeSupportUsername(support) };
  const dirty = JSON.stringify(candidate) !== JSON.stringify(initial);
  const valid =
    (candidate.reviewChatId === null || isChatId(candidate.reviewChatId)) &&
    (candidate.publishChannelId === null || isChatId(candidate.publishChannelId)) &&
    (candidate.supportGroupId === null || isChatId(candidate.supportGroupId)) &&
    Number.isInteger(candidate.submitDailyLimit) &&
    candidate.submitDailyLimit >= 1 &&
    candidate.submitDailyLimit <= 100;

  return (
    <Section
      icon={BotIcon}
      title="机器人"
      description="审核群、发布频道、管理员与收录规则。群组和频道列表来自机器人加入过的聊天。"
      onSubmit={() => save.mutate({ key: "bot", value: candidate })}
      footer={<SaveButton dirty={dirty} pending={save.isPending} disabled={!valid} />}
    >
      <Field
        label="审核消息发送到"
        hint={
          value.reviewMode === "admins"
            ? "投稿、横幅审核和系统通知私信给每位管理员（最多 10 位，需先私聊过机器人）。任一管理员处理后，其他人的副本按钮失效。"
            : "发到下面的审核群；未设置审核群时自动改为私信每位管理员。"
        }
      >
        <OptionSelect
          label="审核消息发送到"
          value={value.reviewMode}
          options={reviewModeOptions}
          onChange={(next) => (next === "chat" || next === "admins") && patch({ reviewMode: next })}
        />
      </Field>
      {value.reviewMode === "chat" && (
        <ChatField
          label="审核群"
          value={value.reviewChatId}
          chats={view.reviewChats}
          emptyLabel="未设置 · 使用默认 ADMIN_CHAT_ID"
          hint="新投稿发到这个群。也可以在群里发 /setreview 绑定。"
          onChange={(reviewChatId) => patch({ reviewChatId })}
        />
      )}
      <ChatField
        label="发布频道"
        value={value.publishChannelId}
        chats={view.publishChannels}
        emptyLabel="不发布"
        hint="审核通过的新条目会发到这个频道（机器人需要是频道管理员）。"
        onChange={(publishChannelId) => patch({ publishChannelId })}
      />
      <SwitchRow
        label="频道日报"
        hint={
          value.publishChannelId
            ? "每天 09:00（北京时间）在发布频道发送新收录和本周涨粉榜。"
            : "需要先设置发布频道。"
        }
        checked={value.dailyDigest}
        onChange={(dailyDigest) => patch({ dailyDigest })}
      />
      <AdminIdsField
        value={value.extraAdminIds}
        superAdminIds={view.superAdminIds}
        onChange={(extraAdminIds) => patch({ extraAdminIds })}
      />
      <SwitchRow
        label="开放收录"
        hint="关闭后机器人不再接受新的投稿。"
        checked={value.submissionsOpen}
        onChange={(submissionsOpen) => patch({ submissionsOpen })}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="每人每日投稿上限" htmlFor="bot-daily-limit" hint="1–100">
          <Input
            id="bot-daily-limit"
            type="number"
            min={1}
            max={100}
            step={1}
            value={Number.isNaN(value.submitDailyLimit) ? "" : value.submitDailyLimit}
            onChange={(event) => patch({ submitDailyLimit: event.target.valueAsNumber })}
          />
        </Field>
        <Field
          label="客服"
          htmlFor="bot-support"
          hint="/support 回复的用户名，留空则不回复联系方式。"
        >
          <Input
            id="bot-support"
            placeholder="@username"
            value={support}
            onChange={(event) => setSupport(event.target.value)}
          />
        </Field>
      </div>
      <SwitchRow
        label="客服中转"
        hint={
          value.supportGroupId
            ? "用户私聊机器人的消息会转到客服群，管理员的回复原样发回给用户。"
            : "需要先设置下面的客服群。"
        }
        checked={value.supportEnabled}
        onChange={(supportEnabled) => patch({ supportEnabled })}
      />
      <ChatField
        label="客服群"
        value={value.supportGroupId}
        chats={view.reviewChats}
        emptyLabel="未设置 · 不中转"
        hint="群里需要开启话题（Topics），机器人必须是管理员并有「管理话题」权限。每位用户对应一个话题：在话题里直接回复就会发回给该用户；发 /ban 拉黑这位用户，发 /done 关闭话题（用户再来消息会自动重开）。"
        onChange={(supportGroupId) => patch({ supportGroupId })}
      />
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="欢迎语（中文）" htmlFor="bot-welcome-zh" hint="留空使用内置文案。">
          <Textarea
            id="bot-welcome-zh"
            maxLength={2000}
            value={value.welcome.zh}
            onChange={(event) => patch({ welcome: { ...value.welcome, zh: event.target.value } })}
          />
        </Field>
        <Field
          label="欢迎语（英文）"
          htmlFor="bot-welcome-en"
          hint="Leave empty for the built-in text."
        >
          <Textarea
            id="bot-welcome-en"
            maxLength={2000}
            value={value.welcome.en}
            onChange={(event) => patch({ welcome: { ...value.welcome, en: event.target.value } })}
          />
        </Field>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- site */

function SiteSection({ initial }: { initial: SiteSettings }) {
  const [announcement, setAnnouncement] = useState(initial.announcement);
  const [blocklistText, setBlocklistText] = useState(formatPostBlocklist(initial.postBlocklist));
  const [hidePostMedia, setHidePostMedia] = useState(initial.hidePostMedia);
  const [showAdSlots, setShowAdSlots] = useState(initial.showAdSlots);
  const save = useSaveSettings();
  const patch = (next: Partial<SiteSettings["announcement"]>) =>
    setAnnouncement((current) => ({ ...current, ...next }));

  const blocklist = parsePostBlocklist(blocklistText);
  const candidate: Omit<SiteSettings, "friendLinks"> = {
    announcement: {
      ...announcement,
      zh: announcement.zh.trim(),
      en: announcement.en.trim(),
      href: announcement.href?.trim() || null,
    },
    postBlocklist: blocklist.keywords,
    hidePostMedia,
    showAdSlots,
  };
  const { friendLinks: _, ...saved } = initial;
  const dirty = JSON.stringify(candidate) !== JSON.stringify(saved);
  const missingText =
    candidate.announcement.enabled && (!candidate.announcement.zh || !candidate.announcement.en);
  const badHref =
    candidate.announcement.href !== null && !candidate.announcement.href.startsWith("https://");

  return (
    <Section
      icon={GlobeIcon}
      title="网站"
      description="首页顶部公告条与最近消息过滤。保存后会标记网站需重建，并自动触发构建。"
      onSubmit={() => save.mutate({ key: "site", value: candidate })}
      footer={
        <SaveButton dirty={dirty} pending={save.isPending} disabled={missingText || badHref} />
      }
    >
      <SwitchRow
        label="显示公告"
        checked={announcement.enabled}
        onChange={(enabled) => patch({ enabled })}
      />
      <div className="grid gap-5 md:grid-cols-2">
        <Field
          label="公告（中文）"
          htmlFor="site-zh"
          error={missingText && !candidate.announcement.zh ? "显示公告时必填" : null}
        >
          <Input
            id="site-zh"
            maxLength={200}
            value={announcement.zh}
            onChange={(event) => patch({ zh: event.target.value })}
          />
        </Field>
        <Field
          label="公告（英文）"
          htmlFor="site-en"
          error={missingText && !candidate.announcement.en ? "显示公告时必填" : null}
        >
          <Input
            id="site-en"
            maxLength={200}
            value={announcement.en}
            onChange={(event) => patch({ en: event.target.value })}
          />
        </Field>
      </div>
      <Field
        label="链接"
        htmlFor="site-href"
        hint="可选，点击公告跳转的 https:// 地址。"
        error={badHref ? "链接需以 https:// 开头" : null}
      >
        <Input
          id="site-href"
          type="url"
          placeholder="https://"
          value={announcement.href ?? ""}
          onChange={(event) => patch({ href: event.target.value })}
        />
      </Field>
      <Field
        label="消息关键词屏蔽"
        htmlFor="site-post-blocklist"
        hint={
          <>
            每行一个关键词，不区分大小写；详情页「最近消息」里包含任一关键词的整条消息不再显示。
            留空表示不过滤。已填写 {blocklist.keywords.length} / {MAX_POST_BLOCKLIST} 个。
            改动在下次网站构建后生效。
            {blocklist.dropped > 0 && (
              <span className="text-warning-foreground">
                {" "}
                超出上限的 {blocklist.dropped} 个关键词不会保存。
              </span>
            )}
          </>
        }
      >
        <Textarea
          id="site-post-blocklist"
          rows={6}
          placeholder={"赌博\n色情\n免费 VPN"}
          value={blocklistText}
          onChange={(event) => setBlocklistText(event.target.value)}
        />
      </Field>
      <SwitchRow
        label="隐藏消息图片"
        hint="开启后「最近消息」只显示文字，不再显示配图。改动在下次网站构建后生效。"
        checked={hidePostMedia}
        onChange={setHidePostMedia}
      />
      <SwitchRow
        label="显示广告位招租"
        hint="没有投放中的付费推广时，是否仍在首页和详情页展示「广告位招租」卡片招揽客户。关闭后整块「赞助商推广」不再出现。"
        checked={showAdSlots}
        onChange={setShowAdSlots}
      />
    </Section>
  );
}

/* ---------------------------------------------------------------- payments */

const networkOptions = [
  { value: "mainnet", label: "主网（mainnet）" },
  { value: "testnet", label: "测试网（testnet）" },
];

function PaymentsSection({ initial, view }: { initial: PaymentSettings; view: SettingsView }) {
  const [value, setValue] = useState(initial);
  const save = useSaveSettings();
  const patch = (next: Partial<PaymentSettings>) =>
    setValue((current) => ({ ...current, ...next }));
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  const badAddress = value.usdtAddress !== "" && !TRON_ADDRESS_RE.test(value.usdtAddress);
  const badExpiry = value.usdtExpiryMinutes < 10 || value.usdtExpiryMinutes > 120;

  return (
    <Section
      icon={CreditCardIcon}
      title="支付"
      description="推广位的付款方式。Stars 由 Telegram 结算；自建 USDT 直接转入你自己的 TRC20 钱包，不经过任何第三方。价格和档位在「推广 → 档位价格」里配置。"
      onSubmit={() => save.mutate({ key: "payments", value })}
      footer={
        <SaveButton dirty={dirty} pending={save.isPending} disabled={badAddress || badExpiry} />
      }
    >
      <SwitchRow
        label="Telegram Stars"
        checked={value.starsEnabled}
        onChange={(starsEnabled) => patch({ starsEnabled })}
      />
      <SwitchRow
        label="USDT（自建收款，TRC20）"
        hint={
          badAddress
            ? "请填写有效的 TRC20 收款地址"
            : "买家按唯一金额转账到下面的地址，到账后约 5 分钟自动确认。无手续费、无第三方。"
        }
        checked={value.usdtSelfEnabled}
        onChange={(usdtSelfEnabled) => patch({ usdtSelfEnabled })}
      />
      <Field
        label="TRC20 收款地址"
        htmlFor="usdt-address"
        hint="以 T 开头的 34 位地址。只填收款地址（公钥），本系统永远不会要求私钥。"
        error={badAddress ? "不是有效的 TRC20 地址" : null}
      >
        <Input
          id="usdt-address"
          autoComplete="off"
          spellCheck={false}
          placeholder="T..."
          value={value.usdtAddress}
          onChange={(event) => patch({ usdtAddress: event.target.value.trim() })}
        />
      </Field>
      <Field
        label="付款时限（分钟）"
        htmlFor="usdt-expiry"
        hint="超时未付款的订单会释放它占用的金额。10–120 分钟。"
      >
        <Input
          id="usdt-expiry"
          type="number"
          min={10}
          max={120}
          value={String(value.usdtExpiryMinutes)}
          onChange={(event) => patch({ usdtExpiryMinutes: Number(event.target.value) })}
        />
      </Field>
      <TronGridCredential view={view} />
      <SwitchRow
        label="USDT（Crypto Pay 第三方）"
        hint={view.hasCryptoPayToken ? undefined : "需要先填写 Crypto Pay token"}
        checked={value.cryptoPayEnabled}
        onChange={(cryptoPayEnabled) => patch({ cryptoPayEnabled })}
      />
      <Field label="Crypto Pay 网络" hint="测试网用于联调，token 需来自 @CryptoTestnetBot。">
        <OptionSelect
          label="Crypto Pay 网络"
          value={value.cryptoPayNetwork}
          options={networkOptions}
          onChange={(next) =>
            (next === "mainnet" || next === "testnet") && patch({ cryptoPayNetwork: next })
          }
        />
      </Field>
      <CryptoPayCredential view={view} />
    </Section>
  );
}

/** A nested form can't live inside the section form, so the token saves via its own button. */
function TronGridCredential({ view }: { view: SettingsView }) {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const keyMissing = !view.configured.SETTINGS_KEY;
  const saveKey = useMutation({
    mutationFn: (value: string) => $setTronGridKey({ data: { token: value } }),
    onSuccess: (result) => {
      if (result.ok) {
        setKey("");
        toastManager.add({ type: "success", title: "TronGrid API key 已保存" });
      } else {
        toastManager.add({ type: "error", title: "未配置 SETTINGS_KEY，无法保存" });
      }
    },
    onError: () =>
      toastManager.add({ type: "error", title: "保存失败", description: "格式不正确" }),
    onSettled: () => invalidate(queryClient, "settings", "audit", "dashboardActivity"),
  });

  return (
    <Field
      label="TronGrid API key（可选）"
      htmlFor="trongrid-key"
      hint="只写：保存后加密存储，不会再显示。不填也能用，走 TronGrid 的免费限流即可（每 5 分钟一次查询远低于上限）。"
    >
      <div className="flex items-center gap-2">
        {view.hasTronGridKey ? (
          <Badge variant="success">已设置</Badge>
        ) : (
          <Badge variant="outline">未设置</Badge>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          id="trongrid-key"
          type="password"
          autoComplete="off"
          placeholder={view.hasTronGridKey ? "输入新 key 以替换" : "留空即可"}
          disabled={keyMissing}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          onKeyDown={(event) => {
            // Enter must not submit the surrounding payments form.
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (key.trim().length >= 10) saveKey.mutate(key.trim());
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={keyMissing || key.trim().length < 10}
          loading={saveKey.isPending}
          onClick={() => saveKey.mutate(key.trim())}
        >
          保存 key
        </Button>
      </div>
    </Field>
  );
}

function CryptoPayCredential({ view }: { view: SettingsView }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const keyMissing = !view.configured.SETTINGS_KEY;
  const saveToken = useMutation({
    mutationFn: (value: string) => $setCryptoPayToken({ data: { token: value } }),
    onSuccess: (result) => {
      if (result.ok) {
        setToken("");
        toastManager.add({ type: "success", title: "Crypto Pay token 已保存" });
      } else {
        toastManager.add({ type: "error", title: "未配置 SETTINGS_KEY，无法保存" });
      }
    },
    onError: () =>
      toastManager.add({ type: "error", title: "保存失败", description: "token 格式不正确" }),
    onSettled: () => invalidate(queryClient, "settings", "audit", "dashboardActivity"),
  });

  return (
    <div className="flex flex-col gap-4 rounded-xl border p-3">
      <Field
        label="Crypto Pay token"
        htmlFor="cryptopay-token"
        hint="只写：保存后加密存储，不会再显示。填写新值会覆盖旧值。"
      >
        <div className="flex items-center gap-2">
          {view.hasCryptoPayToken ? (
            <Badge variant="success">已设置</Badge>
          ) : (
            <Badge variant="outline">未设置</Badge>
          )}
        </div>
        {keyMissing && (
          <p className="flex items-start gap-2 rounded-lg bg-warning/8 p-2.5 text-warning-foreground text-xs dark:bg-warning/16">
            <TriangleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden />
            未配置 SETTINGS_KEY secret，无法加密保存 token。先执行 wrangler secret put
            SETTINGS_KEY。
          </p>
        )}
        <div className="flex gap-2">
          <Input
            id="cryptopay-token"
            type="password"
            autoComplete="off"
            placeholder={view.hasCryptoPayToken ? "输入新 token 以替换" : "12345:AA…"}
            disabled={keyMissing}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            onKeyDown={(event) => {
              // Enter must not submit the surrounding payments form.
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (token.trim().length >= 10) saveToken.mutate(token.trim());
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={keyMissing || token.trim().length < 10}
            loading={saveToken.isPending}
            onClick={() => saveToken.mutate(token.trim())}
          >
            保存 token
          </Button>
        </div>
      </Field>
      <Field label="Webhook 地址" hint="在 @CryptoBot → Crypto Pay → 我的应用 → Webhooks 中填写。">
        {view.cryptoPayWebhookUrl ? (
          <CopyValue value={view.cryptoPayWebhookUrl} />
        ) : (
          <span className="text-muted-foreground text-sm">未配置 BOT_PUBLIC_URL</span>
        )}
      </Field>
    </div>
  );
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toastManager.add({ type: "error", title: "复制失败，请手动选择复制" });
    }
  };
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-2.5 py-1.5 font-mono text-xs">
        {value}
      </code>
      <Button type="button" size="icon-sm" variant="outline" aria-label="复制" onClick={copy}>
        {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ status */

const secretRows: { key: keyof SettingsView["configured"]; label: string; hint: string }[] = [
  { key: "BOT_TOKEN", label: "BOT_TOKEN", hint: "Mini App 登录、Stars 退款" },
  { key: "GITHUB_DISPATCH_TOKEN", label: "GITHUB_DISPATCH_TOKEN", hint: "触发网站构建" },
  { key: "SETTINGS_KEY", label: "SETTINGS_KEY", hint: "加密后台填写的第三方 token" },
];

function StatusSection({ view }: { view: SettingsView }) {
  return (
    <Section
      icon={ShieldCheckIcon}
      title="状态"
      description="Cloudflare secrets 只能用 wrangler 设置，这里只显示是否已配置。"
    >
      <ul className="flex flex-col divide-y rounded-xl border">
        {secretRows.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <div className="font-mono text-sm">{row.label}</div>
              <div className="text-muted-foreground text-xs">{row.hint}</div>
            </div>
            {view.configured[row.key] ? (
              <Badge variant="success">已配置</Badge>
            ) : (
              <Badge variant="warning">未配置</Badge>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
