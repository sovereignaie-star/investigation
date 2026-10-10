const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"]);

/** Video id only for real YouTube hosts (parsed hostname, not a substring match). */
export function youtubeId(src: string): string | null {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;
  const id = url.hostname.toLowerCase().endsWith("youtu.be") ? url.pathname.slice(1).split("/")[0] : url.searchParams.get("v");
  return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
}
