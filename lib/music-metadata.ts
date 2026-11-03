export class MusicResolutionError extends Error {
  constructor(
    message: string,
    public readonly status: number = 502,
    public readonly code: string = "UPSTREAM_RESOLUTION_FAILED",
    public readonly provider?: string,
    public readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = "MusicResolutionError";
  }
}

export interface RecordingIdentity {
  name: string;
  artist: string | null;
  duration?: number | null;
}

function normalize(value: string): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Never select a different artist or remix just because it ranks first. */
export function isSameRecording(
  expected: RecordingIdentity,
  candidate: RecordingIdentity,
): boolean {
  if (!expected.artist || !candidate.artist) return false;
  if (!expected.name || !candidate.name) return false;
  if (normalize(expected.name) !== normalize(candidate.name)) return false;
  if (normalize(expected.artist) !== normalize(candidate.artist)) return false;
  return expected.duration == null || candidate.duration == null
    || Math.abs(expected.duration - candidate.duration) <= 4;
}

export function isMatchingMusicVideo(
  expected: RecordingIdentity,
  title: string,
  channel: string,
): boolean {
  if (!expected.artist) return false;
  const name = normalize(expected.name);
  const artist = normalize(expected.artist);
  const video = normalize(title);
  const owner = normalize(channel);
  if (!name || !artist || !(` ${video} `).includes(` ${name} `)) return false;
  if (!video.includes(artist) && !owner.includes(artist)) return false;
  // Do not substitute covers, live performances, or altered-speed recordings.
  return !["cover", "karaoke", "remix", "live", "sped up", "slowed"]
    .some((variant) => (` ${video} `).includes(` ${variant} `)
      && !(` ${name} `).includes(` ${variant} `));
}

export interface SpotifyEmbedTrack extends RecordingIdentity {
  image: string | null;
  year: number | null;
  previewUrl: string | null;
}

/** Public embed metadata, not oEmbed's title/thumbnail-only response. */
export async function getSpotifyEmbedTrack(id: string): Promise<SpotifyEmbedTrack> {
  let response: Response;
  try {
    response = await fetch(`https://open.spotify.com/embed/track/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(10_000),
      next: { revalidate: 3600 },
    });
  } catch {
    throw new MusicResolutionError(
      "Spotify metadata could not be reached. Please try again later.",
      502, "UPSTREAM_UNAVAILABLE", "spotify",
    );
  }
  if (!response.ok) {
    throw new MusicResolutionError(
      response.status === 404
        ? "Spotify could not find this track. Check the share URL or its regional availability."
        : `Spotify metadata request failed (HTTP ${response.status}).`,
      response.status === 404 ? 404 : 502,
      response.status === 404 ? "SOURCE_NOT_FOUND" : "UPSTREAM_UNAVAILABLE",
      "spotify", response.status,
    );
  }

  let page: any;
  try {
    const html = await response.text();
    const json = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
    if (!json) throw new Error("Missing metadata");
    page = JSON.parse(json)?.props?.pageProps;
  } catch {
    throw new MusicResolutionError(
      "Spotify returned an unrecognized metadata response.",
      502, "INVALID_UPSTREAM_RESPONSE", "spotify",
    );
  }

  // Spotify sometimes serves HTTP 200 containing an embedded 404 page.
  if (page?.status === 404) {
    throw new MusicResolutionError(
      "Spotify could not find this track. Check the share URL or its regional availability.",
      404, "SOURCE_NOT_FOUND", "spotify", 404,
    );
  }
  const entity = page?.state?.data?.entity;
  const artists = Array.isArray(entity?.artists)
    ? entity.artists.map((artist: any) => artist?.name)
      .filter((name: unknown): name is string => typeof name === "string" && !!name.trim())
    : [];
  if (entity?.type !== "track" || entity?.id !== id
    || typeof entity?.name !== "string" || !entity.name.trim() || !artists.length) {
    throw new MusicResolutionError(
      "Spotify did not return verified track and artist metadata.",
      502, "INCOMPLETE_METADATA", "spotify",
    );
  }
  const images = Array.isArray(entity.visualIdentity?.image)
    ? entity.visualIdentity.image.filter((image: any) => typeof image?.url === "string")
    : [];
  images.sort((a: any, b: any) => (b.maxWidth || 0) - (a.maxWidth || 0));
  const date = entity.releaseDate?.isoString;
  const year = typeof date === "string" ? new Date(date).getUTCFullYear() : NaN;
  return {
    name: entity.name.trim(),
    artist: artists.join(", "),
    image: images[0]?.url || null,
    year: Number.isFinite(year) ? year : null,
    duration: typeof entity.duration === "number" ? Math.round(entity.duration / 1000) : null,
    previewUrl: entity.audioPreview?.url || null,
  };
}
