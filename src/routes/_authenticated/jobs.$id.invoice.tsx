import { createFileRoute, redirect } from "@tanstack/react-router";

// The standalone invoice page is retired: invoicing now lives entirely in the
// Fakturering tab on the job page (article-based Fortnox flow). This older page
// used a separate builder that ignored the linked Fortnox customer and could
// create duplicate customers/invoices, so it must not be used. Redirect any
// remaining links or bookmarks to the job's Fakturering tab.
export const Route = createFileRoute("/_authenticated/jobs/$id/invoice")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/jobs/$id", params: { id: params.id }, hash: "invoice" });
  },
});
