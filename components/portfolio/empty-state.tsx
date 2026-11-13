import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyPortfolio({ isOwn }: { isOwn: boolean }) {
  return (
    <div className="mx-auto max-w-xl py-16 text-center" data-testid="empty-portfolio">
      <h2 className="text-xl font-semibold text-ink">No open loans found</h2>
      <p className="mt-3 text-[15px] text-ink-2">
        {isOwn ? "This wallet has" : "This address has"} no MUSD Trove and no borrow on the Morpho markets we support. Every supported protocol was checked.
      </p>
      {isOwn && (
        <>
          <p className="mt-3 text-[15px] text-ink-2">Open a loan on Mezo testnet and it will show up here within a minute.</p>
          <Button asChild variant="secondary" className="mt-6">
            <a href="https://testnet.mezo.org" target="_blank" rel="noreferrer">
              Open a loan on testnet.mezo.org <ExternalLink aria-hidden />
            </a>
          </Button>
        </>
      )}
    </div>
  );
}
