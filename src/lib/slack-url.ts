/** True when the text contains a Slack workspace URL (message/thread links
 * look like `https://<workspace>.slack.com/archives/...`). */
export function containsSlackUrl(text: string): boolean {
  return /https?:\/\/[a-z0-9][a-z0-9-]*\.slack\.com\//i.test(text);
}
