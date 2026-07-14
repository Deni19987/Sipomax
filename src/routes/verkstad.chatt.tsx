import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Hash, MessageSquare, Package, SendHorizonal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import {
  listChatMessagesFn,
  listChatThreadsFn,
  sendChatMessageFn,
} from "@/lib/shop-orders.functions";
import { cn } from "@/lib/utils";

// ?trad=allmant → allmänna kanalen, ?trad=<order-uuid> → ordertråd,
// ingen ?trad → trådlistan.
const GENERAL_THREAD = "allmant";

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

function formatTime(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  return isToday
    ? date.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
}

function ThreadList() {
  const fetchThreads = useServerFn(listChatThreadsFn);
  const { data: threads, isLoading } = useQuery({
    queryKey: ["chat-threads"],
    queryFn: () => fetchThreads(),
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-3 px-4 pt-4">
      <h1 className="text-lg font-bold text-foreground">Chatt</h1>
      <p className="text-xs text-muted-foreground">
        Prata med dina kollegor i verkstaden — allmänt eller om en specifik beställning.
      </p>
      {isLoading ? (
        <div className="rounded-xl bg-card p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">Laddar trådar…</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl bg-card shadow-sm">
          {(threads ?? []).map((thread, index) => (
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
                    {formatTime(thread.lastMessageAt)}
                  </span>
                )}
                {thread.messageCount > 0 && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    {thread.messageCount}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Conversation({ thread }: { thread: string }) {
  const orderId = thread === GENERAL_THREAD ? null : thread;
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchThreads = useServerFn(listChatThreadsFn);
  const fetchMessages = useServerFn(listChatMessagesFn);
  const sendMessage = useServerFn(sendChatMessageFn);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: threads } = useQuery({
    queryKey: ["chat-threads"],
    queryFn: () => fetchThreads(),
  });
  const threadInfo = threads?.find((t) => (t.orderId ?? GENERAL_THREAD) === thread);

  const { data: messages, isLoading } = useQuery({
    queryKey: ["chat-messages", thread],
    queryFn: () => fetchMessages({ data: { orderId } }),
    refetchInterval: 4_000,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages?.length]);

  const mutation = useMutation({
    mutationFn: (body: string) => sendMessage({ data: { orderId, body } }),
    onSuccess: () => {
      setDraft("");
      queryClient.invalidateQueries({ queryKey: ["chat-messages", thread] });
      queryClient.invalidateQueries({ queryKey: ["chat-threads"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Meddelandet kunde inte skickas."),
  });

  function submit() {
    const body = draft.trim();
    if (!body || mutation.isPending) return;
    mutation.mutate(body);
  }

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
          {threadInfo?.subtitle && (
            <p className="truncate text-xs text-muted-foreground">{threadInfo.subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-3 px-4 py-4">
        {isLoading ? (
          <p className="pt-6 text-center text-sm text-muted-foreground">Laddar meddelanden…</p>
        ) : messages && messages.length > 0 ? (
          messages.map((message) => {
            const own = message.senderId === user?.id;
            return (
              <div key={message.id} className={cn("flex", own ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-3.5 py-2 shadow-sm",
                    own
                      ? "rounded-br-md bg-primary text-primary-foreground"
                      : "rounded-bl-md bg-card",
                  )}
                >
                  {!own && (
                    <p className="text-[11px] font-semibold text-primary">{message.senderName}</p>
                  )}
                  <p
                    className={cn(
                      "whitespace-pre-wrap break-words text-sm",
                      own ? "text-primary-foreground" : "text-card-foreground",
                    )}
                  >
                    {message.body}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-right text-[10px]",
                      own ? "text-primary-foreground/70" : "text-muted-foreground",
                    )}
                  >
                    {formatTime(message.createdAt)}
                  </p>
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-xl bg-card p-8 text-center shadow-sm">
            <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold text-card-foreground">Inga meddelanden ännu</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Skriv det första meddelandet i den här tråden.
            </p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-[3.6rem] px-4 pb-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex items-center gap-2 rounded-full bg-card px-4 py-2 shadow-md"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Skriv ett meddelande…"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            aria-label="Skicka"
            disabled={mutation.isPending || !draft.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
          >
            <SendHorizonal className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
