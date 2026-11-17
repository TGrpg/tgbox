import { startPayloadOf } from "@tgbox/shared";
import { Input } from "@/components/coss/ui/input.tsx";
import { Label } from "@/components/coss/ui/label.tsx";

/**
 * A bot's start payload. Pasting the whole `t.me/<bot>?start=…` link keeps just the payload, and
 * the link every page will open is shown, so the admin sees what visitors get.
 */
export function StartPayloadField({
  username,
  value,
  error,
  onChange,
}: {
  username: string;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
}) {
  const payload = value.trim();
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="start-payload">Start 参数</Label>
      <Input
        id="start-payload"
        value={value}
        placeholder="tgbox 或 https://t.me/bot?start=tgbox"
        aria-invalid={error !== null}
        aria-describedby="start-payload-help start-payload-error"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(event) => onChange(startPayloadOf(event.target.value) ?? event.target.value)}
      />
      <p id="start-payload-help" className="text-xs text-muted-foreground">
        {payload && error === null
          ? `全站打开链接：t.me/${username}?start=${payload}`
          : "可填参数或直接粘贴带 ?start= 的链接，全站打开链接都会带上；留空即不带。"}
      </p>
      {error && (
        <p id="start-payload-error" role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
