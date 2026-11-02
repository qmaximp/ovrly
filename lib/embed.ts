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

    // Twitch: обычную страницу канала нельзя встроить, только player/embed.
    // parent обязателен и должен совпадать с доменом страницы (в OBS — тоже).
    const parent =
      typeof window !== "undefined" ? window.location.hostname : "ovrly.ru";
    // Twitch проверяет parent по списку: добавляем основной домен и localhost,
    // чтобы плеер работал и в панели на localhost, и в OBS на ovrly.ru
    const parents = [...new Set([parent, "ovrly.ru", "localhost"])];
    const twitchParams = () => {
      const p = new URLSearchParams();
      for (const h of parents) p.append("parent", h);
      return p;
    };
    if (host === "twitch.tv" || host.endsWith(".twitch.tv")) {
      const parts = u.pathname.split("/").filter(Boolean);
      const p = twitchParams();
      if (host === "clips.twitch.tv") {
        const slug = parts[0] || "";
        if (slug) {
          p.set("clip", slug);
          p.set("autoplay", "true");
          p.set("muted", "true");
          return `https://clips.twitch.tv/embed?${p.toString()}`;
        }
      }
      if (host === "player.twitch.tv") {
        u.searchParams.delete("parent");
        for (const h of parents) u.searchParams.append("parent", h);
        if (!u.searchParams.has("autoplay")) u.searchParams.set("autoplay", "true");
        if (!u.searchParams.has("muted")) u.searchParams.set("muted", "true");
        return u.toString();
      }
      if (parts[0] === "videos" && parts[1]) {
        p.set("video", parts[1]);
        p.set("autoplay", "true");
        p.set("muted", "true");
        return `https://player.twitch.tv/?${p.toString()}`;
      }
      if (parts[0] === "embed") {
        if (parts[1]) p.set("channel", parts[1]);
        // сохраняем остальные параметры встроенной ссылки
        for (const [k, v] of u.searchParams) {
          if (k !== "parent" && !p.has(k)) p.set(k, v);
        }
        if (!p.has("autoplay")) p.set("autoplay", "true");
        if (!p.has("muted")) p.set("muted", "true");
        return `https://www.twitch.tv/embed/${parts[1] || ""}${
          parts[2] ? `/${parts[2]}` : ""
        }?${p.toString()}`;
      }
      if (parts[1] === "chat" && parts[0]) {
        p.set("parent", parent);
        return `https://www.twitch.tv/embed/${encodeURIComponent(parts[0])}/chat?${p.toString()}`;
      }
      if (parts[1] === "clip" && parts[2]) {
        p.set("clip", parts[2]);
        p.set("autoplay", "true");
        p.set("muted", "true");
        return `https://clips.twitch.tv/embed?${p.toString()}`;
      }
      if (parts[0]) {
        p.set("channel", parts[0]);
        // без muted браузер не даёт автозапуск со звуком
        p.set("autoplay", "true");
        p.set("muted", "true");
        return `https://player.twitch.tv/?${p.toString()}`;
      }
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
