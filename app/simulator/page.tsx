import type { Metadata } from "next";
import { Suspense } from "react";
import { SimulatorView } from "@/components/simulator/simulator-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Simulator", description: "See how each of your Mezo loans reacts to a change in the BTC price." };

export default function SimulatorPage() {
  return (
    <Suspense fallback={<div className="container-page py-10"><Skeleton className="h-96" /></div>}>
      <SimulatorView />
    </Suspense>
  );
}
