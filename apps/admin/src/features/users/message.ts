import type { OutgoingMessage } from "@tgbox/shared";

/** A message with every option off: what the one-line composers send. */
export const plainMessage = (text: string): OutgoingMessage => ({
  text,
  format: "plain",
  media: null,
  buttons: [],
  buttonsPerRow: 1,
  silent: false,
  protect: false,
  noPreview: false,
});
