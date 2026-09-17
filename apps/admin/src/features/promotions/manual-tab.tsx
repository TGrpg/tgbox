import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProductKind } from "@tgbox/shared";
import { PlusIcon } from "lucide-react";
import { motion } from "motion/react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/coss/ui/button.tsx";
import { Card } from "@/components/coss/ui/card.tsx";
import { Input } from "@/components/coss/ui/input.tsx";
import { Label } from "@/components/coss/ui/label.tsx";
import { Tabs, TabsList, TabsTab } from "@/components/coss/ui/tabs.tsx";
import { toastManager } from "@/components/coss/ui/toast.tsx";
import { Field } from "@/features/settings/fields.tsx";
import { $createManualPromotion } from "@/functions/promotions.ts";
import { invalidate } from "@/lib/query-keys.ts";
import { BannerPreview } from "./content.tsx";
import { promotionErrorText } from "./labels.ts";

type ManualForm = {
  kind: ProductKind;
  days: number;
  username: string;
  banner: { title: string; subtitle: string; href: string };
};

const empty: ManualForm = {
  kind: "pin",
  days: 7,
  username: "",
  banner: { title: "", subtitle: "", href: "" },
};

export function ManualTab({ onCreated }: { onCreated: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(empty);
  const create = useMutation({
    mutationFn: (input: ManualForm) =>
      $createManualPromotion({
        data:
          input.kind === "pin"
            ? { kind: "pin", days: input.days, username: input.username }
            : { kind: "banner", days: input.days, banner: input.banner },
      }),
    onSuccess: (result) => {
      if (result.ok) {
        toastManager.add({
          type: "success",
          title: "推广已上线",
          description: "已标记网站待构建",
        });
        setForm(empty);
        onCreated();
      } else {
        toastManager.add({
          type: "error",
          title: "无法创建推广",
          description: promotionErrorText[result.error] ?? result.error,
        });
      }
    },
    onError: (error) =>
      toastManager.add({ type: "error", title: "操作失败", description: error.message }),
    onSettled: () =>
      invalidate(
        queryClient,
        "promotions",
        "promotionCounts",
        "adminStats",
        "audit",
        "dashboardActivity",
      ),
  });

  const { banner } = form;
  const bannerValid =
    banner.title.trim().length > 0 &&
    banner.title.trim().length <= 20 &&
    banner.subtitle.trim().length > 0 &&
    banner.subtitle.trim().length <= 40 &&
    banner.href.trim().startsWith("https://");
  const daysValid = Number.isInteger(form.days) && form.days >= 1 && form.days <= 365;
  const valid = daysValid && (form.kind === "pin" ? form.username.trim() !== "" : bannerValid);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) create.mutate(form);
  };
  const setBanner = (patch: Partial<ManualForm["banner"]>) =>
    setForm((current) => ({ ...current, banner: { ...current.banner, ...patch } }));

  return (
    <Card className="max-w-2xl p-4 sm:p-6">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label>类型</Label>
          <Tabs
            value={form.kind}
            onValueChange={(value) =>
              (value === "pin" || value === "banner") &&
              setForm((current) => ({ ...current, kind: value }))
            }
          >
            <TabsList className="self-start">
              <TabsTab value="pin">置顶条目</TabsTab>
              <TabsTab value="banner">首页横幅</TabsTab>
            </TabsList>
          </Tabs>
          <p className="text-muted-foreground text-xs">
            手动推广不收费、立即生效，会占用同类型的名额。
          </p>
        </div>

        <motion.div
          key={form.kind}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="flex flex-col gap-5"
        >
          {form.kind === "pin" ? (
            <Field label="条目用户名" htmlFor="manual-username" hint="必须是已收录的条目。">
              <Input
                id="manual-username"
                placeholder="@username 或 t.me 链接"
                value={form.username}
                onChange={(event) =>
                  setForm((current) => ({ ...current, username: event.target.value }))
                }
              />
            </Field>
          ) : (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="标题"
                  htmlFor="manual-title"
                  hint={`${banner.title.trim().length} / 20`}
                >
                  <Input
                    id="manual-title"
                    maxLength={20}
                    value={banner.title}
                    onChange={(event) => setBanner({ title: event.target.value })}
                  />
                </Field>
                <Field
                  label="副标题"
                  htmlFor="manual-subtitle"
                  hint={`${banner.subtitle.trim().length} / 40`}
                >
                  <Input
                    id="manual-subtitle"
                    maxLength={40}
                    value={banner.subtitle}
                    onChange={(event) => setBanner({ subtitle: event.target.value })}
                  />
                </Field>
              </div>
              <Field label="链接" htmlFor="manual-href" hint="https:// 地址，t.me 链接也可以。">
                <Input
                  id="manual-href"
                  type="url"
                  placeholder="https://"
                  value={banner.href}
                  onChange={(event) => setBanner({ href: event.target.value })}
                />
              </Field>
              <Field label="预览">
                <BannerPreview banner={banner} />
              </Field>
            </>
          )}
        </motion.div>

        <Field label="天数" htmlFor="manual-days" hint="1–365 天，从现在开始计算。">
          <Input
            id="manual-days"
            type="number"
            className="max-w-32"
            min={1}
            max={365}
            step={1}
            value={Number.isNaN(form.days) ? "" : form.days}
            onChange={(event) =>
              setForm((current) => ({ ...current, days: event.target.valueAsNumber }))
            }
          />
        </Field>

        <Button type="submit" className="self-start" disabled={!valid} loading={create.isPending}>
          <PlusIcon aria-hidden />
          创建推广
        </Button>
      </form>
    </Card>
  );
}
