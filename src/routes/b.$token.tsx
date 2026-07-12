import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/b/$token")({
  head: () => ({
    meta: [
      { title: "Boka tid" },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "" },
      { property: "og:description", content: "" },
      { property: "og:image", content: "" },
      { name: "twitter:card", content: "" },
      { name: "twitter:image", content: "" },
    ],
  }),
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/scandic/book/$token",
      params: { token: params.token },
    });
  },
});
