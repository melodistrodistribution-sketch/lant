"use client";

import type { EntityData } from "@/lib/songlink";
import type { IconType } from "react-icons";
import { useState, useRef, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { generateQRMatrix, qrToSVG } from "@/lib/qr";
import { addToHistory } from "@/lib/history";
import { providerStatusKey, type ProviderMatch } from "@/lib/provider-status";
import {
  SiSpotify, SiApplemusic, SiDeezer, SiTidal, SiYoutube, SiYoutubemusic, SiBandcamp,
} from "react-icons/si";
import { FaAmazon } from "react-icons/fa";
import { Play, Pause, ChevronDown, ArrowUpRight, Link2, QrCode, Code2, Copy, Check, Download, AlertCircle } from "lucide-react";
import { MELODISTRO_LOGO } from "./melodistro-asset";
import "./entity-hero.css";

interface EntityHeroProps {
  data: EntityData;
  type: string;
}

const PLATFORMS: { key: string; name: string; Icon: IconType; color: string; aliases?: string[] }[] = [
  { key: "spotify", name: "Spotify", Icon: SiSpotify, color: "#1ed760" },
  { key: "apple", name: "Apple Music", Icon: SiApplemusic, color: "#fa2d48", aliases: ["appleMusic"] },
  { key: "deezer", name: "Deezer", Icon: SiDeezer, color: "#a238ff" },
  { key: "tidal", name: "Tidal", Icon: SiTidal, color: "#e8eef7" },
  { key: "youtube", name: "YouTube", Icon: SiYoutube, color: "#ff2b2b" },
  { key: "youtubemusic", name: "YouTube Music", Icon: SiYoutubemusic, color: "#ff3d3d", aliases: ["youtubeMusic"] },
  { key: "amazonmusic", name: "Amazon Music", Icon: FaAmazon, color: "#25d1da", aliases: ["amazonMusic"] },
  { key: "bandcamp", name: "Bandcamp", Icon: SiBandcamp, color: "#3fb7d3" },
];

function formatDuration(seconds: number | null): string {
  if (!seconds) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

type ShareTab = "links" | "qr" | "embed";

export default function SongEntityHero({ data, type }: EntityHeroProps) {
  const { t } = useI18n();
  const { name, artist, image, links, year, previewUrl, lyrics } = data;
  const imageSrc = image || "/images.svg";
  const isSong = type === "song";

  const typeLabel = type === "artist" ? t("entity.artist") : type === "album" ? t("entity.album") : t("entity.single");
  const subtitleParts = [artist, type === "album" && year ? String(year) : typeLabel].filter(Boolean);
  const subtitle = subtitleParts.join(" \u2022 ");

  const [showLyrics, setShowLyrics] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [total, setTotal] = useState(0);
  const [activeShareTab, setActiveShareTab] = useState<ShareTab>("links");
  const [copiedEmbed, setCopiedEmbed] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const lyricsRef = useRef<HTMLDivElement>(null);

  // Save to history on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const linkedUrl = `/${type}/${generateLinkedIdFromLinks(links)}`;
      addToHistory({
        id: linkedUrl,
        name,
        artist,
        image,
        type: type as "song" | "album" | "artist",
        linkedUrl,
      });
    }
  }, [name, artist, image, type, links]);

  const getHref = (p: (typeof PLATFORMS)[number]): string | undefined => {
    if (links[p.key]) return links[p.key];
    for (const a of p.aliases ?? []) if (links[a]) return links[a];
    return undefined;
  };

  const getOutcome = (p: (typeof PLATFORMS)[number]): ProviderMatch | undefined => {
    const status = data.providerStatus;
    if (!status) return undefined;
    if (status[p.key]) return status[p.key];
    for (const a of p.aliases ?? []) if (status[a]) return status[a];
    return undefined;
  };

  async function togglePreview() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    setAudioError(false);
    try {
      await audio.play();
    } catch {
      setIsPlaying(false);
      setAudioError(true);
    }
  }

  function handleDownloadQR() {
    const svg = qrToSVG(generateQRMatrix(window.location.href));
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `linked-qr-${name.replace(/\s+/g, "-").toLowerCase()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyEmbedCode() {
    const embedUrl = `${window.location.origin}/embed${window.location.pathname}`;
    const code = `<iframe src="${embedUrl}" width="400" height="200" frameborder="0" style="border-radius:12px;border:1px solid #222;"></iframe>`;
    await navigator.clipboard.writeText(code);
    setCopiedEmbed(true);
    setTimeout(() => setCopiedEmbed(false), 2000);
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }

  const qrSvg = typeof window !== "undefined"
    ? qrToSVG(generateQRMatrix(window.location.href))
    : "";

  return (
    <div className={`hero scrollable md-hero md-type-${type}`}>
      <img src={imageSrc} alt="" aria-hidden="true" className="band-image-big md-backdrop" />
      <div className="hero-overlay md-overlay"></div>
      <div className="hero-content md-content">
        <header className="md-release">
          <div className="md-cover-wrap">
            <img src={imageSrc} alt={name} className="entity-cover md-cover" />
          </div>
          <div className="md-meta">
            {isSong && <span className="md-eyebrow">{typeLabel}</span>}
            <h2 className="band md-title">{name}</h2>
            {subtitle && <p className="subtitle md-subtitle">{subtitle}</p>}

            {/* Audio Preview */}
            {previewUrl && isSong && (
              <div className={`audio-preview md-player ${isPlaying ? "is-playing" : ""}`}>
                <audio
                  ref={audioRef}
                  src={previewUrl}
                  preload="none"
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => { setIsPlaying(false); setProgress(0); setElapsed(0); }}
                  onError={() => { setIsPlaying(false); setAudioError(true); }}
                  onLoadedMetadata={(e) => setTotal(e.currentTarget.duration || 0)}
                  onTimeUpdate={(e) => {
                    const a = e.currentTarget;
                    setElapsed(a.currentTime);
                    setProgress(a.duration ? a.currentTime / a.duration : 0);
                  }}
                />
                <button
                  onClick={togglePreview}
                  className="preview-btn md-play"
                  aria-label={isPlaying ? t("entity.preview.pause") : t("entity.preview.play")}
                  data-testid="button-preview"
                >
                  {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                </button>
                <div className="md-player-body">
                  <span className="md-player-label">
                    {isPlaying ? t("entity.preview.pause") : t("entity.preview.play")}
                  </span>
                  <div className="md-track" aria-hidden="true">
                    <div className="md-track-fill" style={{ transform: `scaleX(${progress})` }} />
                  </div>
                  {audioError ? (
                    <span className="md-player-error" role="status"><AlertCircle size={12} /> Preview could not be played</span>
                  ) : (
                    <span className="md-player-time">{formatDuration(elapsed || null)} / {formatDuration(total || null)}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Platform buttons */}
        <div className="platforms md-platforms">
          {PLATFORMS.map((p) => {
            const href = getHref(p);
            const Icon = p.Icon;
            if (!href) {
              const outcome = getOutcome(p);
              return (
                <div key={p.key} className="platform unavailable md-platform md-disabled"
                  aria-disabled="true"
                  data-provider-status={outcome?.status || "unverified"}
                  title={outcome?.message}>
                  <span className="md-picon"><Icon size={20} /></span>
                  <span className="md-pname">{t(providerStatusKey(outcome), { platform: p.name })}</span>
                </div>
              );
            }
            return (
              <a key={p.key} className="platform md-platform" href={href} target="_blank" rel="noopener"
                style={{ ["--brand" as string]: p.color }} data-testid={`link-platform-${p.key}`}>
                <span className="md-picon"><Icon size={20} /></span>
                <span className="md-pname">{t("entity.openOn", { platform: p.name })}</span>
                <ArrowUpRight size={16} className="md-arrow" />
              </a>
            );
          })}
        </div>

        {/* Tracklist for albums */}
        {type === "album" && data.tracks.length > 0 && (
          <section className="tracklist md-card">
            <h3 className="section-title">{t("entity.tracklist")}</h3>
            <ol className="tracklist-list">
              {data.tracks.map((track, i) => (
                <li key={i} className="tracklist-item">
                  <span>{track.name}</span>
                  <span className="track-duration">{formatDuration(track.duration)}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Lyrics section */}
        {isSong && lyrics && (
          <section className="lyrics-section md-card">
            <button
              className="lyrics-toggle md-lyrics-toggle"
              onClick={() => setShowLyrics(!showLyrics)}
              aria-expanded={showLyrics}
            >
              <span>{t("entity.lyrics.title")}</span>
              <ChevronDown size={18} className={`md-chevron ${showLyrics ? "open" : ""}`} />
            </button>
            {showLyrics && (
              <div ref={lyricsRef} className="lyrics-content">
                {lyrics.instrumental ? (
                  <p className="lyrics-instrumental">{t("entity.lyrics.instrumental")}</p>
                ) : lyrics.plainLyrics ? (
                  <pre className="lyrics-text">{lyrics.plainLyrics}</pre>
                ) : (
                  <p className="lyrics-unavailable">{t("entity.lyrics.unavailable")}</p>
                )}
              </div>
            )}
          </section>
        )}

        {/* Share section */}
        <div className="share-section md-card">
          <h3 className="section-title">{t("entity.share.title")}</h3>
          <div className="share-tabs md-tabs" role="tablist">
            {([
              ["links", t("entity.share.copyLink"), Link2],
              ["qr", t("entity.share.qr"), QrCode],
              ["embed", t("entity.share.embed"), Code2],
            ] as const).map(([key, label, TabIcon]) => (
              <button
                key={key}
                role="tab"
                aria-selected={activeShareTab === key}
                className={`share-tab md-tab ${activeShareTab === key ? "active" : ""}`}
                onClick={() => setActiveShareTab(key)}
              >
                <TabIcon size={15} /> {label}
              </button>
            ))}
          </div>

          {activeShareTab === "links" && (
            <div className="share-content">
              <div className="share-link-row md-linkrow">
                <input type="text" value={typeof window !== "undefined" ? window.location.href : ""} readOnly />
                <button onClick={copyLink} className="md-btn">
                  {copiedLink ? <Check size={15} /> : <Copy size={15} />}
                  {copiedLink ? t("home.result.copied") : t("home.result.copy")}
                </button>
              </div>
            </div>
          )}

          {activeShareTab === "qr" && (
            <div className="share-content share-qr md-qr">
              <div className="md-qr-code" dangerouslySetInnerHTML={{ __html: qrSvg }} />
              <button onClick={handleDownloadQR} className="qr-download-btn md-btn">
                <Download size={15} /> {t("entity.qr.download")}
              </button>
            </div>
          )}

          {activeShareTab === "embed" && (
            <div className="share-content">
              <pre className="embed-code md-embed">
{`<iframe src="${typeof window !== "undefined" ? `${window.location.origin}/embed${window.location.pathname}` : ""}" width="400" height="200" frameborder="0" style="border-radius:12px;border:1px solid #222;"></iframe>`}
              </pre>
              <button onClick={copyEmbedCode} className="embed-copy-btn md-btn">
                {copiedEmbed ? <Check size={15} /> : <Copy size={15} />}
                {copiedEmbed ? t("entity.embed.copied") : t("entity.embed.copy")}
              </button>
            </div>
          )}
        </div>

        {isSong && (
          <footer className="md-footer">
            <img src={MELODISTRO_LOGO} alt="" aria-hidden="true" className="md-footer-logo" />
            <span>Powered by Melodistro</span>
          </footer>
        )}
      </div>
    </div>
  );
}

function generateLinkedIdFromLinks(links: Record<string, string>): string {
  // Extract linked ID from the first available link
  for (const [platform, url] of Object.entries(links)) {
    if (url) return `${platform}-${url.split("/").pop()}`;
  }
  return "unknown";
}
