export type ProviderState =
  | "matched"
  | "unavailable"
  | "unsupported"
  | "temporary_error"
  | "configuration_required";

export interface ProviderMatch {
  status: ProviderState;
  url?: string;
  isrc?: string;
  code?: string;
  message?: string;
  httpStatus?: number;
}

export function providerStatusKey(match?: ProviderMatch): string {
  switch (match?.status) {
    case "unavailable": return "entity.provider.noMatch";
    case "unsupported": return "entity.provider.unsupported";
    case "temporary_error": return "entity.provider.temporary";
    case "configuration_required": return "entity.provider.setup";
    default: return "entity.provider.unverified";
  }
}
