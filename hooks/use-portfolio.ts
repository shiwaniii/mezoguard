"use client";
import { useQuery } from "@tanstack/react-query";
import type { PortfolioResponse, PositionDetailResponse } from "@/lib/api-types";
import { api } from "@/lib/wallet/api";
import { decodePortfolio, decodePositionDetail, type Portfolio, type PositionDetail } from "@/lib/wallet/decode";
import { PROTOCOL_SLUG } from "@/lib/wallet/display";
import type { ProtocolId } from "@/lib/risk/types";

export const portfolioKey = (address: string) => ["portfolio", address.toLowerCase()] as const;
export const positionKey = (protocol: ProtocolId, id: string) => ["position", protocol, id.toLowerCase()] as const;

export function usePortfolio(address: string | undefined) {
  return useQuery<Portfolio>({
    queryKey: portfolioKey(address ?? ""),
    enabled: !!address,
    queryFn: async () => decodePortfolio(await api<PortfolioResponse>(`/api/portfolio/${address}`)),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function positionApiPath(protocol: ProtocolId, id: string) {
  return `/api/positions/${protocol}/${encodeURIComponent(id)}`;
}

export async function fetchPositionDetail(protocol: ProtocolId, id: string): Promise<PositionDetail> {
  return decodePositionDetail(await api<PositionDetailResponse>(positionApiPath(protocol, id)));
}

export function usePositionDetail(protocol: ProtocolId | null, id: string) {
  return useQuery<PositionDetail>({
    queryKey: positionKey(protocol ?? "mezo-musd-trove", id),
    enabled: !!protocol && !!id,
    queryFn: () => fetchPositionDetail(protocol as ProtocolId, id),
    refetchInterval: 30_000,
  });
}

export { PROTOCOL_SLUG };
