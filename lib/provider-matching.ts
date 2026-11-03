import { isSameRecording, sameArtistCredits, sameRecordingVersion, type RecordingIdentity } from "./music-metadata";
import type { ProviderMatch } from "./provider-status";

const COUNTRY = "US";
const unavailable = (): ProviderMatch => ({
  status: "unavailable", code: "NO_VERIFIED_MATCH",
  message: `No matching recording was found in the ${COUNTRY} catalog.`,
});
const matched = (url: string, isrc?: string): ProviderMatch => ({ status: "matched", url, isrc });

class CatalogError extends Error {
  constructor(public readonly provider: string, public readonly httpStatus?: number) {
    super(httpStatus ? `${provider} returned HTTP ${httpStatus}.` : `${provider} timed out or returned an invalid response.`);
  }
}

async function catalogJson(url: string, provider: string, headers?: HeadersInit): Promise<any> {
  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 60 },
    });
    if (!response.ok) throw new CatalogError(provider, response.status);
    return await response.json();
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    throw new CatalogError(provider);
  }
}

function failed(error: unknown, authenticated = false): ProviderMatch {
  const e = error instanceof CatalogError ? error : new CatalogError("Catalog");
  const auth = authenticated && (e.httpStatus === 401 || e.httpStatus === 403);
  return {
    status: auth ? "configuration_required" : "temporary_error",
    code: auth ? "CATALOG_AUTHENTICATION_FAILED" : e.httpStatus ? "CATALOG_HTTP_ERROR" : "CATALOG_TIMEOUT_OR_INVALID_RESPONSE",
    message: e.message,
    httpStatus: e.httpStatus,
  };
}

function verifiedUrl(value: unknown, host: RegExp): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && host.test(url.hostname);
  } catch {
    return false;
  }
}

export async function matchAppleRecording(expected: RecordingIdentity): Promise<ProviderMatch> {
  let publicError: unknown;
  try {
    const term = encodeURIComponent(`${expected.name} ${expected.artist}`);
    const search = await catalogJson(`https://itunes.apple.com/search?term=${term}&entity=song&country=${COUNTRY}&limit=100`, "iTunes");
    if (!Array.isArray(search.results)) throw new CatalogError("iTunes");
    const match = (r: any) => r.kind === "song" && isSameRecording(expected, {
      name: r.trackName, artist: r.artistName,
      duration: typeof r.trackTimeMillis === "number" ? r.trackTimeMillis / 1000 : null,
    }) && verifiedUrl(r.trackViewUrl, /^music\.apple\.com$/);
    const direct = search.results.find(match);
    if (direct) return matched(direct.trackViewUrl);

    const artistIds = [...new Set<number>(search.results
      .filter((r: any) => typeof r.artistName === "string" && expected.artist
        && sameArtistCredits(expected.artist, r.artistName) && Number.isSafeInteger(r.artistId))
      .map((r: any) => r.artistId))].slice(0, 2);
    for (const id of artistIds) {
      const catalog = await catalogJson(`https://itunes.apple.com/lookup?id=${id}&entity=song&country=${COUNTRY}&limit=200`, "iTunes");
      if (!Array.isArray(catalog.results)) throw new CatalogError("iTunes");
      const track = catalog.results.find(match);
      if (track) return matched(track.trackViewUrl);
    }
  } catch (error) {
    publicError = error;
  }

  // iTunes Search is public. Apple Music's separate catalog API requires a
  // developer JWT; an iTunes 403 is NOT proof that the recording is absent.
  const developerToken = process.env.APPLE_MUSIC_DEVELOPER_TOKEN;
  if (developerToken) {
    try {
      const query = encodeURIComponent(`${expected.name} ${expected.artist}`);
      const data = await catalogJson(
        `https://api.music.apple.com/v1/catalog/${COUNTRY.toLowerCase()}/search?term=${query}&types=songs&limit=25`,
        "Apple Music", { Authorization: `Bearer ${developerToken}` },
      );
      if (!Array.isArray(data.results?.songs?.data)) {
        if (data.results && !data.results.songs) return unavailable();
        throw new CatalogError("Apple Music");
      }
      const track = data.results.songs.data.find((r: any) => isSameRecording(expected, {
        name: r.attributes?.name, artist: r.attributes?.artistName,
        duration: typeof r.attributes?.durationInMillis === "number" ? r.attributes.durationInMillis / 1000 : null,
      }) && verifiedUrl(r.attributes?.url, /^music\.apple\.com$/));
      if (track) return matched(track.attributes.url, track.attributes.isrc);
      return unavailable();
    } catch (error) {
      return failed(error, true);
    }
  }
  const result = publicError ? failed(publicError) : unavailable();
  if (publicError) result.message += " Public iTunes access failed; an Apple Music developer token enables the separate authenticated catalog fallback.";
  return result;
}

export async function matchDeezerRecording(
  expected: RecordingIdentity,
  isrc?: string | null,
): Promise<ProviderMatch> {
  let inconclusive = false;
  try {
    if (isrc) {
      const track = await catalogJson(`https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`, "Deezer");
      const result = deezerMatch(track, expected);
      if (result) return result;
      if (track.error && track.error.code !== 800) throw new CatalogError("Deezer");
    }
    // Title-only fallback avoids requiring every collaborator to be indexed
    // in Deezer's search text. Full artist credits are checked on track detail.
    const queries = [`${expected.name} ${expected.artist}`, `track:"${expected.name.replace(/"/g, "")}"`];
    for (const query of queries) {
      const data = await catalogJson(`https://api.deezer.com/search/track?q=${encodeURIComponent(query)}&limit=25`, "Deezer");
      if (data.error || !Array.isArray(data.data)) throw new CatalogError("Deezer");
      if (!data.data.length && data.total > 0) inconclusive = true;
      for (const candidate of data.data.slice(0, 25)) {
        if (typeof candidate.id !== "number" || typeof candidate.title !== "string") continue;
        // Do not spend requests fetching metadata for unrelated titles/versions.
        if (!sameRecordingVersion(expected, {
          name: candidate.title,
          duration: typeof candidate.duration === "number" ? candidate.duration : null,
        })) continue;
        const detail = await catalogJson(`https://api.deezer.com/track/${candidate.id}`, "Deezer");
        const result = deezerMatch(detail, expected);
        if (result) return result;
      }
    }
    return inconclusive ? {
      status: "temporary_error", code: "EMPTY_CATALOG_RESPONSE",
      message: "Deezer reported catalog hits but returned no track data. Availability cannot be determined.",
    } : unavailable();
  } catch (error) {
    return failed(error);
  }
}

function deezerMatch(track: any, expected: RecordingIdentity): ProviderMatch | null {
  const artists = Array.isArray(track.contributors) && track.contributors.length
    ? track.contributors.map((a: any) => a.name).filter((name: unknown) => typeof name === "string").join(", ")
    : track.artist?.name;
  if (!isSameRecording(expected, { name: track.title, artist: artists, duration: track.duration })
    || !verifiedUrl(track.link, /^(www\.)?deezer\.com$/)) return null;
  return matched(track.link, typeof track.isrc === "string" ? track.isrc : undefined);
}

const tidalTokens = new Map<string, { token: string; expires: number }>();

function durationSeconds(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const m = value.match(/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : null;
}

export function matchTidalDocument(document: any, expected: RecordingIdentity): ProviderMatch | null {
  const rows = Array.isArray(document.data) ? document.data : [document.data];
  const included = Array.isArray(document.included) ? document.included : [];
  for (const row of rows) {
    const track = row?.attributes ? row : included.find((r: any) => r.type === "tracks" && r.id === row?.id);
    if (track?.type !== "tracks" || !/^\d+$/.test(track.id)) continue;
    const artistIds = track.relationships?.artists?.data;
    if (!Array.isArray(artistIds)) continue;
    const artists = artistIds.map((id: any) => included.find((r: any) => r.type === "artists" && r.id === id.id)?.attributes?.name);
    if (!artists.length || artists.some((a: unknown) => typeof a !== "string")) continue;
    const title = track.attributes?.version
      ? `${track.attributes.title} (${track.attributes.version})` : track.attributes?.title;
    if (isSameRecording(expected, { name: title, artist: artists.join(", "), duration: durationSeconds(track.attributes?.duration) })) {
      return matched(`https://tidal.com/browse/track/${track.id}`, track.attributes?.isrc);
    }
  }
  return null;
}

/** /searchResults returns a JSON:API collection, not a single data object. */
export function tidalSearchTrackIds(document: any): string[] {
  if (!Array.isArray(document.data)) throw new CatalogError("Tidal");
  const ids: string[] = [];
  for (const result of document.data) {
    const tracks = result?.relationships?.tracks?.data;
    if (!Array.isArray(tracks)) throw new CatalogError("Tidal");
    for (const track of tracks) {
      if (track?.type !== "tracks" || typeof track.id !== "string" || !/^\d+$/.test(track.id)) {
        throw new CatalogError("Tidal");
      }
      ids.push(track.id);
    }
  }
  return [...new Set(ids)];
}

export async function matchTidalRecording(expected: RecordingIdentity, isrc?: string | null): Promise<ProviderMatch> {
  const clientId = process.env.TIDAL_CLIENT_ID;
  const clientSecret = process.env.TIDAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return {
    status: "configuration_required", code: "MISSING_TIDAL_CREDENTIALS",
    message: "Tidal catalog matching requires TIDAL_CLIENT_ID and TIDAL_CLIENT_SECRET.",
  };
  try {
    let token = tidalTokens.get(clientId);
    if (!token || token.expires <= Date.now()) {
      let response: Response;
      try {
        response = await fetch("https://auth.tidal.com/v1/oauth2/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          },
          body: "grant_type=client_credentials", signal: AbortSignal.timeout(8000), cache: "no-store",
        });
      } catch { throw new CatalogError("Tidal authorization"); }
      if (!response.ok) throw new CatalogError("Tidal authorization", response.status);
      const auth = await response.json();
      if (typeof auth.access_token !== "string" || !Number.isFinite(auth.expires_in)) throw new CatalogError("Tidal authorization");
      token = { token: auth.access_token, expires: Date.now() + Math.max(0, auth.expires_in - 60) * 1000 };
      tidalTokens.set(clientId, token);
    }
    const headers = { Authorization: `Bearer ${token.token}`, Accept: "application/vnd.api+json" };
    if (isrc) {
      const data = await catalogJson(`https://openapi.tidal.com/v2/tracks?filter%5Bisrc%5D=${encodeURIComponent(isrc)}&countryCode=${COUNTRY}&include=artists`, "Tidal", headers);
      const track = matchTidalDocument(data, expected);
      if (track) return track;
    }
    // Current public OpenAPI: /searchResults with filter[query], not an
    // undocumented GraphQL endpoint or an ISRC-only shortcut.
    const term = encodeURIComponent(`${expected.name} ${expected.artist}`);
    const search = await catalogJson(`https://openapi.tidal.com/v2/searchResults?filter%5Bquery%5D=${term}&countryCode=${COUNTRY}&include=tracks`, "Tidal", headers);
    const ids = tidalSearchTrackIds(search);
    const included = Array.isArray(search.included) ? search.included : [];
    for (const id of ids.slice(0, 10)) {
      const candidate = included.find((r: any) => r.type === "tracks" && r.id === id);
      if (candidate?.attributes && !sameRecordingVersion(expected, {
        name: candidate.attributes.title,
        duration: durationSeconds(candidate.attributes.duration),
      })) continue;
      const detail = await catalogJson(`https://openapi.tidal.com/v2/tracks/${encodeURIComponent(id)}?countryCode=${COUNTRY}&include=artists`, "Tidal", headers);
      const track = matchTidalDocument(detail, expected);
      if (track) return track;
    }
    return unavailable();
  } catch (error) {
    const result = failed(error, true);
    if (result.httpStatus === 401) tidalTokens.delete(clientId);
    return result;
  }
}
