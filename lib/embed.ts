const YT_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "youtu.be"];

// iframe-элемент = сайт по ссылке. Для сервисов, которые отдают embed-версию,
// подставляем её: обычная страница youtube/vimeo/rutube в iframe не открывается
export function toEmbedUrl(raw: string): string {
  let url = (raw || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");

    if (YT_HOSTS.includes(u.hostname.toLowerCase())) {
      let videoId = "";
      if (u.hostname.toLowerCase() === "youtu.be") {
        videoId = u.pathname.slice(1).split("/")[0];
      } else if (u.pathname === "/watch") {
        videoId = u.searchParams.get("v") || "";
      } else if (u.pathname.startsWith("/shorts/") || u.pathname.startsWith("/live/")) {
        videoId = u.pathname.split("/")[2] || "";
      } else if (u.pathname.startsWith("/embed/")) {
        return u.toString();
      }
      const list = u.searchParams.get("list");
      // видео + list: embed с параметром list продолжит плейлист после ролика
      if (videoId && list)
        return `https://www.youtube.com/embed/${videoId}?list=${encodeURIComponent(list)}`;
      if (videoId) return `https://www.youtube.com/embed/${videoId}`;
      if (list)
        return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(list)}`;
      return u.toString();
    }

    // Vimeo: /video/<id>, /channels/<...>/<id>, /<id>
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const m = u.pathname.match(/(\d{6,})/);
      if (m) return `https://player.vimeo.com/video/${m[1]}`;
    }

    // Rutube: /video/<id>/ и /shorts/<id>/
    if (host === "rutube.ru") {
      const parts = u.pathname.split("/").filter(Boolean);
      if ((parts[0] === "video" || parts[0] === "shorts") && parts[1])
        return `https://rutube.ru/play/embed/${parts[1]}`;
    }

    // Dailymotion: /video/<id> и короткие dai.ly/<id>
    if (host === "dailymotion.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.indexOf("video");
      const id = idx >= 0 ? parts[idx + 1] : parts[0];
      if (id) return `https://www.dailymotion.com/embed/video/${id}`;
    }
    if (host === "dai.ly") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id) return `https://www.dailymotion.com/embed/video/${id}`;
    }

    return u.toString();
  } catch {
    return raw;
  }
}

// id плейлиста YouTube (list=...); нужен, чтобы отличить ссылку на готовый
// плейлист от ссылки на отдельное видео
export function youtubePlaylistId(raw: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    if (!YT_HOSTS.includes(u.hostname.toLowerCase())) return null;
    return u.searchParams.get("list") || null;
  } catch {
    return null;
  }
}

// youtube-ли это? (для вставки из буфера: ссылка на видео → элемент-iframe)
export function isYouTubeLink(raw: string): boolean {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    return YT_HOSTS.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}
