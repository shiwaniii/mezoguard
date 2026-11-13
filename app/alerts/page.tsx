import type { Metadata } from "next";
import { AlertsView } from "@/components/alerts/alerts-view";

export const metadata: Metadata = { title: "Alerts", robots: { index: false } };

export default function AlertsPage() {
  return <AlertsView />;
}
