import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Hash, MessageSquare, SendHorizonal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  listChatMessagesFn,
  listWorkshopMembersFn,
  markThreadReadFn,
  searchOrderRefsFn,
  sendChatMessageFn,
} from "@/lib/shop-orders.functions";
import {
  chatThreadKey,
  findActiveToken,
  formatChatTime,
  parseChatBody,
  serializeChatBody,
  type ChatMessage,
} from "@/lib/shop/chat";
import { cn } from "@/lib/utils";

type TagPick = { sigil: "@" | "#"; label: string; id: string };

/**
 * All datalogik för en tråd: hämtning, läsmarkering och optimistiskt skick.
 * Bryts ut ur komponenten så att meddelandelistan och komponeraren kan
 * placeras var för sig — orderdetaljerna har dem i olika kort.
 */
export function useOrderChat(orderId: string | null) {
  const threadKey = chatThreadKey(orderId);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fetchMessages = useServerFn(listChatMessagesFn);
  const sendMessage = useServerFn(sendChatMessageFn);
  const markRead = useServerFn(markThreadReadFn);

  const { data: messages, isLoading } = useQuery({
    queryKey: ["chat-messages", threadKey],
    queryFn: () => fetchMessages({ data: { orderId } }),
    refetchInterval: 4_000,
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages?.length]);

  // Markera tråden som läst när den öppnas och när nya meddelanden landar,
  // så att olästmarkeringarna i orderlistan och trådlistan stämmer.
  const lastMessageAt = messages?.[messages.length - 1]?.createdAt ?? null;
  useEffect(() => {
    let cancelled = false;
    markRead({ data: { orderId } })
      .then(() => {
        if (cancelled) return;
        queryClient.invalidateQueries({ queryKey: ["chat-threads"] });
        queryClient.invalidateQueries({ queryKey: ["workshop-orders"] });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [orderId, lastMessageAt, markRead, queryClient]);

  async function submit(text: string, picks: TagPick[]) {
    const { body, mentions, orderRefs } = serializeChatBody(text, picks);

    // Optimistiskt: visa meddelandet direkt och stäm av mot serverns kopia när
    // svaret kommer (eller rulla tillbaka om det small). Pollningen kan hinna
    // hämta serverkopian först, därför dedupas det på id i båda vägarna.
    const tempId = `optimistic-${crypto.randomUUID()}`;
    const optimistic: ChatMessage = {
      id: tempId,
      orderId,
      senderId: user?.id ?? "",
      senderName: "Du",
      body,
      createdAt: new Date().toISOString(),
      mentions,
      orderRefs,
      optimistic: true,
    };
    queryClient.setQueryData(["chat-messages", threadKey], (old: ChatMessage[] | undefined) =>
      old ? [...old, optimistic] : [optimistic],
    );

    try {
      const saved = await sendMessage({ data: { orderId, body, mentions, orderRefs } });
      queryClient.setQueryData(["chat-messages", threadKey], (old: ChatMessage[] | undefined) => {
        const rest = (old ?? []).filter((m) => m.id !== tempId);
        if (!rest.some((m) => m.id === saved.id)) rest.push(saved);
        return rest;
      });
      queryClient.invalidateQueries({ queryKey: ["chat-threads"] });
      queryClient.invalidateQueries({ queryKey: ["workshop-orders"] });
      if (mentions.filter((id) => id !== user?.id).length > 0) {
        toast.success("Kollegan har notifierats.");
      }
      return true;
    } catch (err) {
      queryClient.setQueryData(["chat-messages", threadKey], (old: ChatMessage[] | undefined) =>
        (old ?? []).filter((m) => m.id !== tempId),
      );
      toast.error(err instanceof Error ? err.message : "Meddelandet kunde inte skickas.");
      return false;
    }
  }

  return { messages, isLoading, submit, ownId: user?.id, bottomRef };
}

/** Meddelandelistan i en tråd. */
export function ChatMessageList({
  chat,
  className,
  emptyHint,
}: {
  chat: ReturnType<typeof useOrderChat>;
  className?: string;
  emptyHint?: string;
}) {
  const { messages, isLoading, ownId, bottomRef } = chat;
  return (
    <div className={cn("space-y-3", className)}>
      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Laddar meddelanden…</p>
      ) : messages && messages.length > 0 ? (
        messages.map((message) => (
          <MessageBubble key={message.id} message={message} ownId={ownId} />
        ))
      ) : (
        <div className="rounded-xl bg-muted/50 p-6 text-center">
          <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm font-semibold text-card-foreground">Inga meddelanden ännu</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {emptyHint ?? "Skriv det första meddelandet i den här tråden."}
          </p>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

/** Komponeraren med @- och #-taggning. */
export function ChatComposer({
  chat,
  orderId,
  onSent,
}: {
  chat: ReturnType<typeof useOrderChat>;
  orderId: string | null;
  onSent?: () => void;
}) {
  return (
    <Composer
      orderId={orderId}
      onSubmit={async (text, picks) => {
        const ok = await chat.submit(text, picks);
        if (ok) onSent?.();
        return ok;
      }}
    />
  );
}

/**
 * Intern chatt för verkstaden i ett stycke: lista + komponerare. Samma
 * komponent driver den allmänna kanalen (orderId = null) och ordertrådarna.
 *
 * - "page" fyller hela vyn med en fast komponerare i botten (chatt-fliken).
 * - "panel" är en inbäddad variant.
 */
export function ChatThread({
  orderId,
  variant = "page",
  emptyHint,
}: {
  orderId: string | null;
  variant?: "page" | "panel";
  emptyHint?: string;
}) {
  const chat = useOrderChat(orderId);

  return (
    <div
      className={cn(
        "flex flex-col",
        // Mobil: sidan växer och komponeraren klistrar sig ovanför bottenmenyn.
        // Desktop: tråden fyller sin panel och bara meddelandelistan scrollar.
        variant === "page" ? "min-h-[calc(100vh-12rem)] lg:min-h-0 lg:flex-1" : "gap-3",
      )}
    >
      <ChatMessageList
        chat={chat}
        emptyHint={emptyHint}
        className={cn(
          "flex-1",
          variant === "page"
            ? "px-4 py-4 lg:min-h-0 lg:overflow-y-auto"
            : "max-h-96 overflow-y-auto pr-1 lg:max-h-[28rem]",
        )}
      />

      <div
        className={cn(
          variant === "page" && "sticky bottom-[3.6rem] px-4 pb-2 lg:static lg:pb-4 lg:pt-0",
        )}
      >
        <ChatComposer chat={chat} orderId={orderId} />
      </div>
    </div>
  );
}

function MessageBubble({ message, ownId }: { message: ChatMessage; ownId?: string }) {
  const own = message.senderId === ownId;
  const mentionsMe = !!ownId && message.mentions.includes(ownId);

  return (
    <div className={cn("flex", own ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 shadow-sm",
          own ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-card",
          !own && mentionsMe && "ring-2 ring-primary/40",
          message.optimistic && "opacity-70",
        )}
      >
        {!own && <p className="text-[11px] font-semibold text-primary">{message.senderName}</p>}
        <p
          className={cn(
            "whitespace-pre-wrap break-words text-sm",
            own ? "text-primary-foreground" : "text-card-foreground",
          )}
        >
          {parseChatBody(message.body).map((segment, index) => {
            if (segment.type === "text") return <span key={index}>{segment.text}</span>;
            if (segment.type === "mention") {
              return (
                <span
                  key={index}
                  className={cn(
                    "rounded px-1 font-semibold",
                    own
                      ? "bg-primary-foreground/20"
                      : segment.userId === ownId
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-foreground",
                  )}
                >
                  @{segment.label}
                </span>
              );
            }
            return (
              <Link
                key={index}
                to="/verkstad"
                search={{ order: segment.orderId }}
                className={cn(
                  "rounded px-1 font-semibold underline-offset-2 hover:underline",
                  own ? "bg-primary-foreground/20" : "bg-primary/10 text-primary",
                )}
              >
                #{segment.label}
              </Link>
            );
          })}
        </p>
        <p
          className={cn(
            "mt-0.5 text-right text-[10px]",
            own ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          {message.optimistic ? "Skickar…" : formatChatTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}

function Composer({
  onSubmit,
  orderId,
}: {
  onSubmit: (text: string, picks: TagPick[]) => Promise<boolean>;
  orderId: string | null;
}) {
  const [draft, setDraft] = useState("");
  const [picks, setPicks] = useState<TagPick[]>([]);
  const [sending, setSending] = useState(false);
  const [token, setToken] = useState<{
    sigil: "@" | "#";
    query: string;
    start: number;
    end: number;
  } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const fetchMembers = useServerFn(listWorkshopMembersFn);
  const searchOrders = useServerFn(searchOrderRefsFn);

  const { data: members } = useQuery({
    queryKey: ["workshop-members"],
    queryFn: () => fetchMembers(),
    staleTime: 5 * 60_000,
  });

  const { data: orderHits } = useQuery({
    queryKey: ["order-refs", token?.sigil === "#" ? token.query : null],
    queryFn: () => searchOrders({ data: { query: token?.query ?? "" } }),
    enabled: token?.sigil === "#",
    staleTime: 30_000,
  });

  const suggestions = useMemo(() => {
    if (!token) return [];
    if (token.sigil === "@") {
      const q = token.query.toLowerCase();
      return (members ?? [])
        .filter(
          (m) =>
            !q || m.name.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q),
        )
        .slice(0, 6)
        .map((m) => ({ id: m.id, label: m.name, hint: m.email ?? "" }));
    }
    return (orderHits ?? []).slice(0, 6).map((o) => ({
      id: o.id,
      label: String(o.orderNumber),
      hint: o.customerName ?? "Okänd kund",
    }));
  }, [token, members, orderHits]);

  function syncToken(value: string, caret: number) {
    const active = findActiveToken(value, caret);
    setToken(active ? { ...active, end: caret } : null);
  }

  function applySuggestion(suggestion: { id: string; label: string }) {
    if (!token) return;
    const inserted = `${token.sigil}${suggestion.label} `;
    const next = `${draft.slice(0, token.start)}${inserted}${draft.slice(token.end)}`;
    setDraft(next);
    setPicks((prev) => [
      ...prev,
      { sigil: token.sigil, label: suggestion.label, id: suggestion.id },
    ]);
    setToken(null);
    requestAnimationFrame(() => {
      const caret = token.start + inserted.length;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  }

  // Startar en tagg från knapparna i verktygsraden.
  function startToken(sigil: "@" | "#") {
    const needsSpace = draft.length > 0 && !/\s$/.test(draft);
    const next = `${draft}${needsSpace ? " " : ""}${sigil}`;
    setDraft(next);
    setToken({ sigil, query: "", start: next.length - 1, end: next.length });
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.length, next.length);
    });
  }

  async function handleSubmit() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const ok = await onSubmit(text, picks);
    setSending(false);
    if (ok) {
      setDraft("");
      setPicks([]);
      setToken(null);
    }
  }

  return (
    <div className="relative">
      {token && suggestions.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          <p className="border-b border-border px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
            {token.sigil === "@" ? "Tagga en kollega" : "Tagga en order"}
          </p>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applySuggestion(suggestion)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent"
            >
              {token.sigil === "@" ? (
                <AtSign className="h-3.5 w-3.5 shrink-0 text-primary" />
              ) : (
                <Hash className="h-3.5 w-3.5 shrink-0 text-primary" />
              )}
              <span className="truncate text-sm font-medium text-card-foreground">
                {suggestion.label}
              </span>
              {suggestion.hint && (
                <span className="ml-auto truncate text-xs text-muted-foreground">
                  {suggestion.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
        className="flex items-end gap-2 rounded-2xl bg-card px-3 py-2 shadow-md"
      >
        <div className="flex shrink-0 gap-1 pb-1">
          <button
            type="button"
            aria-label="Tagga en kollega"
            onClick={() => startToken("@")}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground"
          >
            <AtSign className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Tagga en order"
            onClick={() => startToken("#")}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground"
          >
            <Hash className="h-3.5 w-3.5" />
          </button>
        </div>
        <textarea
          ref={inputRef}
          value={draft}
          rows={1}
          onChange={(e) => {
            setDraft(e.target.value);
            syncToken(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setToken(null);
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          onClick={(e) => syncToken(draft, e.currentTarget.selectionStart ?? draft.length)}
          placeholder={orderId ? "Kommentera ordern…" : "Skriv ett meddelande…"}
          className="max-h-32 min-h-[2rem] w-full resize-none bg-transparent py-1 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          aria-label="Skicka"
          disabled={sending || !draft.trim()}
          className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
        >
          <SendHorizonal className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
