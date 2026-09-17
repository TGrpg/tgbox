# Social preview image

`apps/web/public/og-default.png` (1200×630) is the Open Graph / Twitter card image. It is a
committed asset, not a build artifact — regenerate it only when the branding changes:

```bash
"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
  --headless=new --disable-gpu --hide-scrollbars --window-size=1200,630 \
  --screenshot=/tmp/og-raw.png "file://$PWD/scripts/og/og-default.html"
node -e "require('sharp')('/tmp/og-raw.png').png({compressionLevel:9,palette:true,effort:10})\
  .toFile('apps/web/public/og-default.png')"
```

Any Chromium works. Fonts must include a CJK face, or the Chinese line renders as boxes.
