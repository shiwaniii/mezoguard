"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="container-page max-w-xl py-20" role="alert">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Something went wrong on this page</h1>
      <p className="mt-2 text-[15px] text-ink-2">
        Nothing was sent from your wallet. Try again, and if it keeps happening, reload the page.
      </p>
      {error.digest && <p className="mt-2 font-mono text-[12px] text-ink-3">Reference {error.digest}</p>}
      <Button className="mt-6" onClick={reset}>Try again</Button>
    </div>
  );
}
