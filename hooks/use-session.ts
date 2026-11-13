"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignMessage } from "wagmi";
import type { SessionResponse } from "@/lib/api-types";
import { api } from "@/lib/wallet/api";

export const sessionKey = ["session"] as const;

export function useSession() {
  return useQuery<SessionResponse>({
    queryKey: sessionKey,
    queryFn: () => api<SessionResponse>("/api/session"),
    staleTime: 60_000,
    retry: 0,
  });
}

/** EIP-191 sign-in: GET /api/auth/nonce → personal_sign → POST /api/auth/verify. */
export function useSignIn() {
  const qc = useQueryClient();
  const { address } = useAccount();
  const sign = useSignMessage();
  return useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("Connect a wallet first.");
      const { message } = await api<{ message: string }>(`/api/auth/nonce?address=${address}`);
      const signature = await sign.signMessageAsync({ message });
      return api<SessionResponse>("/api/auth/verify", { method: "POST", json: { address, message, signature } });
    },
    onSuccess: (s) => {
      qc.setQueryData(sessionKey, s);
      qc.invalidateQueries();
    },
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<SessionResponse>("/api/auth/logout", { method: "POST" }),
    onSuccess: (s) => {
      qc.setQueryData(sessionKey, s);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "session" && q.queryKey[0] !== "portfolio" && q.queryKey[0] !== "position" });
    },
  });
}
