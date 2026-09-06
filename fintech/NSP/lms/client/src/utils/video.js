/* Shared video-URL helpers.
 * Normalises pasted share links (YouTube watch/short, Vimeo) into embeddable
 * iframe URLs. A raw youtube.com/watch?v= link refuses to load in an <iframe>
 * (X-Frame-Options), which is why the Training tab previously showed
 * "video unavailable". */

export function getYouTubeId(url) {
  if (!url) return null;
  const short = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (short) return short[1];
  const watch = url.match(/youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/);
  if (watch) return watch[1];
  const embed = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embed) return embed[1];
  const shorts = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shorts) return shorts[1];
  return null;
}

export function getVimeoId(url) {
  if (!url) return null;
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? m[1] : null;
}

export function isDirectVideo(url) {
  return !!url && /\.(mp4|webm|ogg|mov)(\?|$)/i.test(url);
}

/* Returns an embeddable iframe URL, or null when the URL is a direct video
 * file (caller should use a <video> element instead). */
export function toEmbedUrl(url) {
  if (!url) return null;
  const yt = getYouTubeId(url);
  if (yt) return `https://www.youtube.com/embed/${yt}?rel=0&modestbranding=1&playsinline=1`;
  const vm = getVimeoId(url);
  if (vm) return `https://player.vimeo.com/video/${vm}`;
  if (isDirectVideo(url)) return null;
  // Unknown host — return as-is so an already-embeddable URL still works.
  return url;
}
