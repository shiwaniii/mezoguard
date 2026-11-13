import type { Metadata } from "next";
import { DashboardRedirect } from "@/components/portfolio/dashboard-redirect";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };

export default function DashboardPage() {
  return <DashboardRedirect />;
}
