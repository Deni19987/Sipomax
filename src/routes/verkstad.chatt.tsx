import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, AtSign, ExternalLink, Hash, Package, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { ChatThread } from "@/components/workshop/chat-thread";
import { listChatThreadsFn } from "@/lib/shop-orders.functions";
import { GENERAL_THREAD, formatChatTime } from "@/lib/shop/chat";
import { cn } from "@/lib/utils";

// ?trad=allmant → allmänna kanalen, ?trad=<order-uuid> → ordertråd,
// ingen ?trad → trådlistan.
export const Route = createFileRoute("/verkstad/chatt")({
  ssr: false,
  validateSearch: z.object({ trad: z.string().optional() }),
  component: WorkshopChatPage,
});

function WorkshopChatPage() {
  const { trad } = Route.useSearch();
  if (!trad) return <ThreadList />;
  return <Conversation thread={trad} />;
}

function ThreadList() {
  const fetchThreads = useServerFn(listChatThreadsFn);
  const { data: threads, isLoading } = useQuery({
    queryKey: ["chat-threads"],
    queryFn: () => fetchThreads(),
    refetchInterval: 15_000,
  });

  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return threads ?? [];
    return (threads ?? []).filter((thread) =>
      `${thread.title} ${thread.subtitle ?? ""} ${thread.lastMessage ?? ""}`
        .toLowerCase()
        .includes(term),
    );
  }, [threads, search]);

  const unreadTotal = (threads ?? []).reduce((sum, t) => sum + t.unreadCount, 0);

  return (
    <div className="space-y-3 px-4 pt-4">
      <div>
        <h1 className="text-lg font-bold text-foreground">Chatt</h1>
        <p className="text-xs text-muted-foreground">
          Allmän kanal för hela verkstaden och en egen tråd per beställning.
          {unreadTotal > 0 ? ` ${unreadTotal} olästa.` : ""}
        </p>
      </div>

      <label className="flex items-center gap-2 rounded-xl bg-card px-3 py-2 shadow-sm">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Sök tråd, order eller kund…"
          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>

      {isLoading ? (
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">Laddar trådar…</p>
        </div>
      ) : visible.length > 0 ? (
        <div className="overflow-hidden rounded-xl bg-card shadow-sm">
          {visible.map((thread, index) => (
            <Link
              key={thread.orderId ?? "general"}
              to="/verkstad/chatt"
              search={{ trad: thread.orderId ?? GENERAL_THREAD }}
              className={cn(
                "flex items-center gap-3 p-4 transition-colors hover:bg-accent",
                index > 0 && "border-t border-border",
              )}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                {thread.orderId ? <Package className="h-5 w-5" /> : <Hash className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-card-foreground">{thread.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {thread.lastMessage ?? thread.subtitle ?? "Inga meddelanden ännu"}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {thread.lastMessageAt && (
                  <span className="text-[11px] text-muted-foreground">
                    {formatChatTime(thread.lastMessageAt)}
                  </span>
                )}
                {thread.unreadCount > 0 ? (
                  <span
                    className={cn(
                      "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      thread.mentionsMe
                        ? "bg-primary text-primary-foreground"
                        : "bg-primary/10 text-primary",
                    )}
                  >
                    {thread.mentionsMe && <AtSign className="h-3 w-3" />}
                    {thread.unreadCount}
                  </span>
                ) : (
                  thread.messageCount > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {thread.messageCount} meddelanden
                    </span>
                  )
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <p className="text-sm font-semibold text-card-foreground">
            Inga trådar matchar sökningen
          </p>
        </div>
      )}
    </div>
  );
}

function Conversation({ thread }: { thread: string }) {
  const orderId = thread === GENERAL_THREAD ? null : thread;
  const navigate = useNavigate();
  const fetchThreads = useServerFn(listChatThreadsFn);

  const { data: threads } = useQuery({
    queryKey: ["chat-threads"],
    queryFn: () => fetchThreads(),
  });
  const threadInfo = threads?.find((t) => (t.orderId ?? GENERAL_THREAD) === thread);

  return (
    <div className="flex min-h-[calc(100vh-8.5rem)] flex-col">
      <div className="sticky top-[calc(env(safe-area-inset-top)+3.4rem)] z-10 flex items-center gap-3 border-b border-border bg-neutral-100/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          aria-label="Till alla trådar"
          onClick={() => navigate({ to: "/verkstad/chatt", search: {} })}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-card shadow-sm"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">
            {threadInfo?.title ?? (orderId ? "Ordertråd" : "Allmänt")}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {threadInfo?.subtitle ??
              (orderId ? "Tagga en kollega med @" : "Tagga en beställning med #")}
          </p>
        </div>
        {orderId && (
          <Link
            to="/verkstad"
            search={{ order: orderId }}
            aria-label="Öppna ordern"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card shadow-sm"
          >
            <ExternalLink className="h-4 w-4" />
          </Link>
        )}
      </div>

      <ChatThread
        orderId={orderId}
        variant="page"
        emptyHint={
          orderId
            ? "Skriv det första meddelandet om den här ordern."
            : "Skriv till hela verkstaden. Tagga en beställning med # för att länka den."
        }
      />
    </div>
  );
}
